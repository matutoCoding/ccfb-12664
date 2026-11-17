// 工程卡片缩略图：离屏 canvas 画形状轮廓 -> dataURL
import { Viewport } from './viewport.js';
import { bbox } from '../core/math.js';
import { drawShapeOutline } from './viewport.js';

export async function makeThumbnail(project) {
  const canvas = document.createElement('canvas');
  canvas.width = 480; canvas.height = 220;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#12161a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const all = (project.shapes || []).flatMap(s => s.points);
  if (!all.length) {
    ctx.fillStyle = '#5a6570';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('空白工程', canvas.width / 2, canvas.height / 2);
    return canvas.toDataURL('image/png');
  }
  const box = bbox(all);
  const vp = new Viewport();
  vp.fit(box, canvas.width, canvas.height, 24);
  for (const s of project.shapes) {
    if (s.visible !== false) drawShapeOutline(ctx, vp, s, false, false);
  }
  return canvas.toDataURL('image/png');
}
