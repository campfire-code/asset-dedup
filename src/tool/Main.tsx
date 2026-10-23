// 主界面：选文件夹 → 扫描算指纹 → 按组展示重复 / 近似图 → 一键把多余的移到「待删除」。
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Check, FolderOpen, FolderSearch, Images, ScanSearch, Square, SquareCheck, X } from 'lucide-react';
import { stat, rename, exists } from '@tauri-apps/plugin-fs';
import { dirname } from '@tauri-apps/api/path';
import type { CustomTool } from '../kit/types';
import { expandPaths, fileSrc, openFolder, pickFolder, reveal, settingsStore } from '../kit/platform';
import { ProgressBar, useDroppedFiles } from '../kit/parts';
import { IMAGE_EXT, TRASH_DIR, formatBytes, groupAssets, planMoves, similarity, thresholdLabel, hamming, type Asset, type Group } from './core';
import { moveFiles, scanFiles, type FoundFile, type ScanResult } from './flow';
import { decodeImage } from './decode';
import { demoState } from './demo';
import './tool.css';

type Ctx = Parameters<CustomTool['Main']>[0]['ctx'];
const PREFS_KEY = 'c24.prefs';
const DEFAULT_T = 6;
const isPreview = () => typeof location !== 'undefined' && location.pathname.endsWith('/preview.html');

interface Scan extends ScanResult { groups: Group[]; roots: string[] }
type Msg = { kind: 'ok' | 'err'; text: string; dir?: string } | null;

function Tile({ a, keep, skipped, distance, same, onKeep }: { a: Asset; keep: boolean; skipped: boolean; distance: number | null; same: boolean; onKeep: () => void }) {
  const folder = a.path.slice(a.root.length).replace(/^[\\/]/, '').split(/[\\/]/).slice(0, -1).join('/');
  return (
    <button className={`ad-tile${keep ? ' keep' : skipped ? '' : ' out'}`} onClick={onKeep} title={`${a.path}\n点击设为保留`}>
      <span className="ad-img">
        {a.thumb ? <img src={fileSrc(a.thumb)} alt="" loading="lazy" /> : <Images size={22} />}
        {!skipped && <span className={`ad-badge ${keep ? 'keep' : 'out'}`}>{keep ? <><Check size={12} />保留</> : <><ArrowRightLeft size={12} />移走</>}</span>}
      </span>
      <span className="ad-name k-ellipsis">{a.name}</span>
      <span className="ad-meta k-muted k-num">{a.width}×{a.height} · {formatBytes(a.size)}</span>
      <span className="ad-meta k-num ad-sim">{keep ? '保留这张' : same ? '与保留的文件完全相同' : distance === 0 ? '画面一致，文件不同' : `相似度 ${similarity(distance ?? 0)}`}</span>
      {folder && <span className="ad-meta k-muted k-ellipsis">位于 {folder}</span>}
    </button>
  );
}

export function Main({ ctx }: { ctx?: Ctx }) {
  const [threshold, setThreshold] = useState(DEFAULT_T);
  const [sources, setSources] = useState<string[]>([]);
  const [scan, setScan] = useState<Scan | null>(null);
  const [keep, setKeep] = useState<Record<number, string>>({});
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<'' | 'scan' | 'move'>('');
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [showFailed, setShowFailed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (isPreview()) {
      const d = demoState();
      setSources(d.roots);
      setScan(d);
      loaded.current = true;
      return;
    }
    (async () => {
      try {
        const v = (await (await settingsStore()).get<{ threshold?: number }>(PREFS_KEY))?.threshold;
        if (typeof v === 'number' && v >= 0 && v <= 16) setThreshold(v);
      } catch { /* 首次打开用默认值 */ }
      loaded.current = true;
    })();
  }, []);
  useEffect(() => {
    if (!loaded.current || isPreview()) return;
    const id = setTimeout(async () => { try { await (await settingsStore()).set(PREFS_KEY, { threshold }); } catch { /* 忽略 */ } }, 400);
    return () => clearTimeout(id);
  }, [threshold]);

  // 改阈值后直接重新分组，不用重新读文件
  const groups = useMemo(() => (scan ? (isPreview() && threshold === DEFAULT_T ? scan.groups : groupAssets(scan.assets, threshold)) : []), [scan, threshold]);
  useEffect(() => { setKeep({}); setSkip(new Set()); setConfirm(false); }, [groups]);

  const join = (...p: string[]) => p.join(p[0]?.includes('\\') && !p[0].includes('/') ? '\\' : '/');
  const plans = useMemo(() => planMoves(groups, keep, skip, join), [groups, keep, skip]);
  const freed = plans.reduce((s, p) => s + p.size, 0);

  const hover = useDroppedFiles((paths) => { if (!busy) addSources(paths); });
  function addSources(paths: string[]) {
    setSources((s) => [...s, ...paths.filter((p) => !s.includes(p))]);
    setScan(null);
    setMsg(null);
  }

  async function runScan() {
    if (!ctx || isPreview()) return setMsg({ kind: 'err', text: '预览模式下不能扫描' });
    setBusy('scan');
    setMsg(null);
    setConfirm(false);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const found: FoundFile[] = [];
      const roots: string[] = [];
      for (const src of sources) {
        const info = await stat(src);
        const root = info.isDirectory ? src : await dirname(src);
        roots.push(root);
        for (const it of await expandPaths([src], IMAGE_EXT)) found.push({ path: it.path!, name: it.name, size: it.size ?? 0, root });
      }
      const uniq = [...new Map(found.map((f) => [f.path, f])).values()];
      if (!uniq.length) throw new Error('没有找到图片（支持 jpg、jpeg、png、webp、bmp、gif）');
      setProgress([0, uniq.length]);
      const r = await scanFiles(uniq, { readFile: ctx.readFile, decode: decodeImage }, (d, t) => setProgress([d, t]), ac.signal);
      setScan({ ...r, groups: groupAssets(r.assets, threshold), roots: [...new Set(roots)] });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
    abort.current = null;
    setBusy('');
  }

  async function runMove() {
    if (!ctx || isPreview()) return setMsg({ kind: 'err', text: '预览模式下不能移动文件' });
    setBusy('move');
    setConfirm(false);
    try {
      const r = await moveFiles(plans, { join: ctx.join, mkdir: ctx.mkdir, writeText: ctx.writeText, exists: (p) => exists(p), rename: (a, b) => rename(a, b) }, new Date());
      const movedSet = new Set(r.moved.map((m) => m.from));
      const dir = r.moved[0] ? r.moved[0].to.slice(0, Math.max(r.moved[0].to.lastIndexOf('/'), r.moved[0].to.lastIndexOf('\\'))) : undefined;
      // 移走的从结果里去掉，剩下的重新分组
      setScan((s) => (s ? { ...s, assets: s.assets.filter((a) => !movedSet.has(a.path)) } : s));
      const fail = r.failed.length ? `；${r.failed.length} 个没移动：${r.failed.slice(0, 2).map((f) => `${f.plan.from.split(/[\\/]/).pop()}（${f.reason}）`).join('、')}` : '';
      setMsg({ kind: r.failed.length ? 'err' : 'ok', text: `已把 ${r.moved.length} 个文件移到「${TRASH_DIR}」文件夹，没有删除任何文件，移动清单也存在那里${fail}`, dir });
    } catch (e) {
      setMsg({ kind: 'err', text: `移动失败：${e instanceof Error ? e.message : String(e)}` });
    }
    setBusy('');
  }

  const ratio = progress[1] ? progress[0] / progress[1] : 0;
  const totalImgs = scan ? scan.assets.length : 0;

  return (
    <div className="ad">
      <section className="ad-bar k-panel">
        <div className="ad-src">
          <button className="k-btn" disabled={!!busy} onClick={async () => { const p = await pickFolder().catch(() => null); if (p) addSources([p]); }}><FolderSearch size={15} />选择文件夹</button>
          {sources.length ? (
            <span className="ad-chips">
              {sources.map((s) => (
                <span key={s} className="k-chip ad-chip" title={s}>
                  <span className="k-ellipsis">{s}</span>
                  {!busy && <button className="k-icon-btn" aria-label="移除" onClick={() => { setSources(sources.filter((x) => x !== s)); setScan(null); }}><X size={13} /></button>}
                </span>
              ))}
            </span>
          ) : <span className="k-muted">也可以把文件夹或图片直接拖进窗口</span>}
        </div>
        <div className="ad-th">
          <label className="k-label" htmlFor="ad-th">相似度阈值 <b className="k-num">{threshold}</b></label>
          <input id="ad-th" type="range" min={0} max={16} step={1} value={threshold} disabled={busy === 'scan'} onChange={(e) => setThreshold(Number(e.target.value))} />
          <span className="k-help">{thresholdLabel(threshold)}</span>
        </div>
        {busy === 'scan'
          ? <button className="k-btn" onClick={() => abort.current?.abort()}><Square size={14} />停止</button>
          : <button className="k-btn primary" disabled={!sources.length || !!busy} onClick={runScan}><ScanSearch size={15} />开始查重</button>}
      </section>

      {busy === 'scan' && (
        <div className="ad-prog"><ProgressBar ratio={ratio} label="扫描进度" /><span className="k-muted k-num">正在读取 {progress[0]} / {progress[1]}</span></div>
      )}
      {msg && (
        <div className={`k-notice ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>
          <span>{msg.text}</span>
          {msg.dir && <button className="k-link" onClick={() => openFolder(msg.dir!)}>打开待删除文件夹</button>}
          <button className="k-icon-btn" aria-label="关闭提示" onClick={() => setMsg(null)}><X size={14} /></button>
        </div>
      )}

      {!scan && busy !== 'scan' && (
        <div className={`ad-empty k-panel${hover ? ' hover' : ''}`}>
          <Images size={34} />
          <b>选一个素材文件夹，找出重复和近似重复的图片</b>
          <span className="k-muted">用画面指纹比对：改了尺寸、压缩过、轻微调色、加了小角标的也能认出来。<br />重复项只会移到「{TRASH_DIR}」文件夹，不会直接删除。全部在本机完成，不上传。</span>
        </div>
      )}

      {scan && (
        <>
          <div className="ad-sum">
            <span className="k-num">扫描 <b>{totalImgs}</b> 张 · 找到 <b>{groups.length}</b> 组重复 · 可移走 <b>{plans.length}</b> 张（约 {formatBytes(freed)}）</span>
            {scan.failed.length > 0 && <button className="k-link" onClick={() => setShowFailed(!showFailed)}><AlertTriangle size={14} />{scan.failed.length} 张读取失败</button>}
            <span className="ad-sp" />
            {confirm ? (
              <span className="ad-confirm">
                <span>把 {plans.length} 张移到各自文件夹下的「{TRASH_DIR}」？</span>
                <button className="k-btn primary" onClick={runMove}>确认移动</button>
                <button className="k-btn" onClick={() => setConfirm(false)}>取消</button>
              </span>
            ) : (
              <button className="k-btn primary" disabled={!plans.length || !!busy} onClick={() => setConfirm(true)}><ArrowRightLeft size={15} />{busy === 'move' ? '正在移动…' : `把重复项移到「${TRASH_DIR}」`}</button>
            )}
          </div>
          {showFailed && (
            <ul className="ad-failed k-panel">
              {scan.failed.map((f) => <li key={f.path}><button className="k-link" onClick={() => reveal(f.path)}>{f.name}</button><span className="k-muted">{f.reason}</span></li>)}
            </ul>
          )}
          {groups.length === 0 ? (
            <div className="ad-empty k-panel"><Check size={30} /><b>没有发现重复图片</b><span className="k-muted">可以把阈值调大一点再看看，阈值越大越宽松。</span></div>
          ) : (
            <div className="ad-groups">
              {groups.map((g, gi) => {
                const keepId = keep[gi] ?? g.members[0].id;
                const keeper = g.members.find((m) => m.id === keepId)!;
                const skipped = skip.has(gi);
                return (
                  <section key={g.members.map((m) => m.id).join()} className={`ad-group k-panel${skipped ? ' skipped' : ''}`}>
                    <header className="ad-gh">
                      <b>第 {gi + 1} 组</b>
                      <span className={`ad-kind ${g.exact ? 'exact' : 'near'}`}>{g.exact ? '完全相同' : '近似'}</span>
                      <span className="k-muted k-num">{g.members.length} 张{!g.exact ? (g.maxDistance === 0 ? ' · 画面一致，尺寸或文件不同' : ` · 最低相似度 ${similarity(g.maxDistance)}`) : ''}</span>
                      <span className="ad-sp" />
                      <button className="k-btn ghost ad-skip" aria-pressed={skipped} onClick={() => { const n = new Set(skip); if (skipped) n.delete(gi); else n.add(gi); setSkip(n); }}>
                        {skipped ? <SquareCheck size={15} /> : <Square size={15} />}这组不处理
                      </button>
                    </header>
                    <div className="ad-tiles">
                      {g.members.map((m) => (
                        <Tile key={m.id} a={m} keep={m.id === keepId} skipped={skipped} distance={m.id === keepId ? null : m.content === keeper.content ? 0 : hamming(m.hash, keeper.hash)} same={m.content === keeper.content} onKeep={() => setKeep({ ...keep, [gi]: m.id })} />
                      ))}
                    </div>
                  </section>
                );
              })}
              <p className="k-muted ad-tip"><FolderOpen size={13} /> 每组默认保留分辨率最高的一张，点任意一张可改成保留它。移走的文件放在扫描文件夹下的「{TRASH_DIR}」里，确认无误后再自己删除。</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
