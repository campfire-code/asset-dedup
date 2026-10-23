// 工具声明：素材库查重（自定义界面：选文件夹 → 扫描 → 分组展示 → 重复项移到「待删除」）。
import { ScanSearch as ScanSearchAsIcon } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Main } from './Main';

const tool: CustomTool = {
  id: 'c24',
  name: '素材库查重',
  tagline: '扫描图片文件夹，用画面指纹找出完全相同和近似重复（改过尺寸、压缩、调色、加角标）的图片，分组展示，一键把多余的移到「待删除」文件夹，不直接删除。',
  icon: ScanSearchAsIcon,
  category: '内容生产',
  type: 'media',
  mode: 'custom',
  mainLabel: '查重',
  params: [],
  Main: ({ ctx }) => createElement(Main, { ctx }),
};

export default tool;
