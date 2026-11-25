import { MAX_GLYPHS } from './limits.ts';

/** Named character ramps, ordered from empty to dense. */
export const charsets = {
  standard: ' .:-=+*#%@',
  minimal: ' .:+',
  detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: ' ░▒▓█',
  braille: ' ⠁⠃⠇⡇⣇⣧⣷⣿',
  dots: ' ·•●',
  binary: ' .01',
  lines: ' -=≡',
  rain: ' .:;|!1',
  code: ' .:;=+<>/{}#',
  letters: ' ilcoaxsezwmkbdqgW',
  kana: ' ･ｰｼﾂｳｶｸｹｺｻﾅﾆﾇﾊﾋﾐﾓﾔﾗﾜ',
} as const;

export type CharsetName = keyof typeof charsets;

export const DEFAULT_CHARSET: CharsetName = 'standard';

/**
 * Turns a charset name or a literal ramp into a list of glyphs.
 * Names win over literals, so `'dots'` means the named set.
 * A single character becomes `[' ', char]`.
 */
export function resolveCharset(input: string | undefined, fallback: string = DEFAULT_CHARSET): string[] {
  const pick = (value: string): string[] => {
    const named = Object.prototype.hasOwnProperty.call(charsets, value)
      ? (charsets as Record<string, string>)[value]
      : undefined;
    return Array.from(named ?? value);
  };
  let glyphs = input === undefined || input === '' ? pick(fallback) : pick(input);
  if (glyphs.length === 0) glyphs = pick(DEFAULT_CHARSET);
  if (glyphs.length === 1) glyphs = [' ', glyphs[0]!];
  return glyphs.slice(0, MAX_GLYPHS);
}
