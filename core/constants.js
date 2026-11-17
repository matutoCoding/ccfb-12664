// 全局常量与默认参数。内部单位：0.1mm（与 DST 针迹分辨率一致）

export const UNIT_MM = 0.1;                 // 1 内部单位 = 0.1mm
export const MM = 1 / UNIT_MM;             // mm -> 内部单位的倍率
export const DEFAULT_DENSITY = 0.4;        // mm，针距（填充行距）
export const DEFAULT_RUN_STITCH = 2.5;     // mm，平针针步长
export const DEFAULT_SATIN_WIDTH = 3.0;    // mm，包针默认宽度
export const DEFAULT_ZIG_WIDTH = 2.0;      // mm，锯齿针默认宽度
export const DEFAULT_ZIG_AMPL = 1.2;       // mm，锯齿振幅
export const DEFAULT_UNDERLAY_INSET = 0.3; // mm，底线下缩量
export const DEFAULT_PULL_COMP = 0.2;      // mm，收缩补偿（外扩）
export const DEFAULT_TRIM_GAP_MM = 7.0;    // 空跳超过该长度自动插剪线
export const DEFAULT_JUMP_MM = 12.1;       // DST 单条跳针最大跨度（0.1mm*121）
export const MAX_DST_BYTE = 121;           // DST 每轴 ±121 (0.1mm)
export const SCHEMA_VERSION = 1;

export const STITCH_TYPES = {
  RUN: 'run',          // 平针
  SATIN: 'satin',      // 包针/他他米柱
  TATAMI: 'tatami',    // 榻榻米
  ZIGZAG: 'zigzag'     // 锯齿针
};

export const STITCH_TYPE_LABELS = {
  run: '平针',
  satin: '包针',
  tatami: '榻榻米',
  zigzag: '锯齿针'
};

// 针迹记录标志位
export const F = {
  NORMAL: 0,
  JUMP: 1,        // 跳针
  TRIM: 2,        // 剪线
  COLOR: 4,       // 换色
  END: 8,         // 结束
  LOCK: 16        // 锁针
};

export const SHAPE_KINDS = {
  PATH: 'path',       // 开放/闭合轮廓线
  RECT: 'rect',
  ELLIPSE: 'ellipse'
};

export function defaultParams(type) {
  const d = {
    density: DEFAULT_DENSITY,
    runLength: DEFAULT_RUN_STITCH,
    width: DEFAULT_SATIN_WIDTH,
    zigAmplitude: DEFAULT_ZIG_AMPL,
    underlay: true,
    underlayInset: DEFAULT_UNDERLAY_INSET,
    pullComp: DEFAULT_PULL_COMP,
    shortStitch: true,        // 长短针
    shortRatio: 0.65,
    lockStitch: true
  };
  if (type) d.type = type;
  return d;
}

export function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + '_' +
    Math.random().toString(36).slice(2, 8);
}
