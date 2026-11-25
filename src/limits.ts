// Sizes of the uniform arrays shared by the CPU side and the field shader.
// Keep the total under WebGL2's minimum of 224 fragment uniform vectors.
export const MAX_POINTS = 48;
export const MAX_SEGMENTS = 80;
export const MAX_TRAIL = 20;
export const MAX_PULSES = 8;
export const MAX_CLEAR = 4;
export const MAX_GLYPHS = 256;
