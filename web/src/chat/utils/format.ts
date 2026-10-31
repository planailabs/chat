/** A tool call's arguments as text, cut to `max` characters. */
export const formatToolArgs = (input: unknown, max: number, pretty: boolean): string => {
  if (input === null || input === undefined) return '';
  const text = typeof input === 'string' ? input : JSON.stringify(input, null, pretty ? 2 : undefined) ?? '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
