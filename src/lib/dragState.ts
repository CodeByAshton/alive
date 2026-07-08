// The vault path being dragged right now (tree row or editor tab) — shared
// module state because dataTransfer payloads aren't readable during dragover,
// only on drop.

export const dragState: { path: string | null } = { path: null };
