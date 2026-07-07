export function parseFrontmatter(text: string): { data: Record<string, any>; body: string };
export function serializeFrontmatter(data: Record<string, any>, body: string): string;
