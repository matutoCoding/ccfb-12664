// 绣线色板：内置 Madeira 经典色号及通用色板
import { uid } from '../core/constants.js';

export const MADEIRA_PALETTE = [
  { code: '1000', name: '雪白', hex: '#F7F7F2' },
  { code: '1012', name: '乳白', hex: '#F2EAD6' },
  { code: '1036', name: '浅香槟', hex: '#E8D9A8' },
  { code: '1058', name: '柠檬黄', hex: '#F6E000' },
  { code: '1070', name: '金黄', hex: '#F2B705' },
  { code: '1080', name: '橙黄', hex: '#F28E13' },
  { code: '1100', name: '橘红', hex: '#E85D26' },
  { code: '1140', name: '大红', hex: '#D82018' },
  { code: '1164', name: '酒红', hex: '#8E1C2B' },
  { code: '1185', name: '玫红', hex: '#D6387B' },
  { code: '1220', name: '粉红', hex: '#F4A7C0' },
  { code: '1250', name: '浅紫', hex: '#B49BD4' },
  { code: '1270', name: '紫罗兰', hex: '#6E3FA3' },
  { code: '1300', name: '藏青', hex: '#1F3864' },
  { code: '1320', name: '宝蓝', hex: '#1F5FC4' },
  { code: '1345', name: '天蓝', hex: '#5DB7E8' },
  { code: '1370', name: '湖蓝', hex: '#2E9CA6' },
  { code: '1400', name: '墨绿', hex: '#1E5631' },
  { code: '1420', name: '翠绿', hex: '#2E8B57' },
  { code: '1450', name: '草绿', hex: '#7CB342' },
  { code: '1480', name: '橄榄', hex: '#7A7A2E' },
  { code: '1500', name: '咖啡', hex: '#6B4423' },
  { code: '1520', name: '驼色', hex: '#B08968' },
  { code: '1550', name: '深灰', hex: '#4A4A4A' },
  { code: '1570', name: '银灰', hex: '#9AA0A6' },
  { code: '1599', name: '黑色', hex: '#1A1A1A' }
].map(c => ({ ...c, id: uid('col'), brand: 'Madeira Rayon' }));

export function createPalette() {
  // 工程默认携带一份色板副本（可增删改，互不影响）
  return MADEIRA_PALETTE.map(c => ({ ...c, id: uid('col') }));
}

export const FABRICS = [
  { id: 'white', name: '白色棉布', hex: '#F5F2EA' },
  { id: 'black', name: '黑色布料', hex: '#202124' },
  { id: 'denim', name: '牛仔蓝', hex: '#3D5A80' },
  { id: 'khaki', name: '卡其', hex: '#C2B280' },
  { id: 'red', name: '大红布', hex: '#9E2B25' }
];

export const HOOPS = [
  { id: 'h100', name: '100mm 圆绷', w: 1000, h: 1000, shape: 'circle' },
  { id: 'h180', name: '180×130 长方绷', w: 1800, h: 1300, shape: 'rect' },
  { id: 'h200', name: '200×200 方绷', w: 2000, h: 2000, shape: 'rect' },
  { id: 'h300', name: '300×200 大绷', w: 3000, h: 2000, shape: 'rect' }
];
