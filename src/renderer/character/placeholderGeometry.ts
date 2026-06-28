export type PlaceholderCatAction = 'standing' | 'sitting' | 'walking' | 'sleeping';

export interface GridPoint {
  x: number;
  y: number;
}

export interface GridBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const SLEEPING_BODY_BOUNDS: GridBounds = {
  left: 6,
  top: 8,
  right: 13,
  bottom: 15,
};

export const SLEEPING_HEAD_BOUNDS: GridBounds = {
  left: 7,
  top: 5,
  right: 16,
  bottom: 10,
};

export function placeholderHeadOriginForAction(action: PlaceholderCatAction): GridPoint {
  if (action === 'walking') return { x: 8, y: 4 };
  if (action === 'sitting') return { x: 7, y: 4 };
  if (action === 'sleeping') return { x: 7, y: 4 };
  return { x: 8, y: 4 };
}

export function placeholderHeadBoundsForAction(action: PlaceholderCatAction): GridBounds {
  if (action === 'sleeping') return SLEEPING_HEAD_BOUNDS;
  const { x, y } = placeholderHeadOriginForAction(action);
  return {
    left: x,
    top: y + 1,
    right: x + 9,
    bottom: y + 6,
  };
}
