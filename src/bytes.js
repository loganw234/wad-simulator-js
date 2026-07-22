// Little-endian byte helpers, shared so no two modules declare their own `u32` (which a
// flat single-file bundle would see as a top-level collision).

export const u16 = (d, o) => d[o] | (d[o + 1] << 8);
export const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
export const putU16 = (d, o, v) => { d[o] = v & 0xff; d[o + 1] = (v >>> 8) & 0xff; };
export const putU32 = (d, o, v) => {
  d[o] = v & 0xff; d[o + 1] = (v >>> 8) & 0xff; d[o + 2] = (v >>> 16) & 0xff; d[o + 3] = (v >>> 24) & 0xff;
};
export const alignUp = (v, a) => (v + a - 1) & ~(a - 1);
export const align16 = (x) => Math.ceil(x / 16) * 16;
