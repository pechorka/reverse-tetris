const game = /** @type {HTMLCanvasElement} */(document.getElementById("game"));
if (!game) throw new Error("no canvas");
const ctx  = /** @type {CanvasRenderingContext2D} */(game.getContext("2d"));

const WIDTH = 10, HEIGHT = 20, CELL_SIZE = 35;
const COLOR_BACKGROUND = "#1b1f32";
const MAX_BLOCK_SPAWN = 7;
const BORDER_DEFAULT = "#273244";
const BORDER_HOVER = "#f0c987";
const BORDER_SELECTED = "#7bdff2";
const PREVIEW_ROWS = 1;
const CELL_MARGIN = 4;
const CELL_GAP_COLOR = "#161b26";
const GHOST_FILL_ALPHA = 0.2;
const GHOST_BORDER_ALPHA = 0.65;
const TEXT_COLOR = "#e2e8f0";
const LABEL_COLOR = "#cbd5f5";
const BLOCK_COLORS = ["#8ab6f9", "#f5b0e3", "#9fd8c0", "#f8d89e"];
const BORDER_COLORS_BY_LENGTH = {
  1: "#f0c987",
  2: "#7ec4cf",
  3: "#9f87af",
  4: "#6c8ebf",
  default: "#cbd5f5",
};
const FALL_ANIMATION_PER_ROW = 120; // ms per row drop
const MIN_FALL_DURATION = 120;
game.width = WIDTH * CELL_SIZE; 
game.height = (HEIGHT + PREVIEW_ROWS) * CELL_SIZE;

const idx = (x, y) => y * WIDTH + x;

function makeCell(color, blockId = null) {
  return { color, blockId };
}

function copyCell(cell) {
  return { color: cell.color, blockId: cell.blockId };
}

function isEmptyCell(cell) {
  return cell.color === COLOR_BACKGROUND;
}

function borderColorForLength(length) {
  if (!length) return BORDER_DEFAULT;
  return BORDER_COLORS_BY_LENGTH[length] || BORDER_COLORS_BY_LENGTH.default;
}

const grid = Array.from({ length: WIDTH * HEIGHT }, () => makeCell(COLOR_BACKGROUND));
const colors = [...BLOCK_COLORS, COLOR_BACKGROUND];

let topLine = -1;
let selectedBlock = null;
let hoveredBlock = null;
let score = 0;
let nextRow = null;
let fallingAnimation = null;
let blockCounter = 0;

function nextBlockId() {
  blockCounter += 1;
  return blockCounter;
}

function moveBlocksUp() {
  topLine++;
  // Shift every cell up by one row
  for (let y = 1; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      grid[idx(x, y - 1)] = copyCell(grid[idx(x, y)]);
    }
  }
  // Clear bottom row
  for (let x = 0; x < WIDTH; x++) grid[idx(x, HEIGHT - 1)] = makeCell(COLOR_BACKGROUND);
}

function generateNextRow() {
  const row = Array.from({ length: WIDTH }, () => makeCell(COLOR_BACKGROUND));
  let spawned = 0;
  let x = 0;

  while (x < WIDTH && spawned < MAX_BLOCK_SPAWN) {
    const maxLen = Math.min(4, MAX_BLOCK_SPAWN - spawned, WIDTH - x);
    if (maxLen <= 0) break;

    const color = colors[Math.floor(Math.random() * colors.length)];
    const len = 1 + Math.floor(Math.random() * maxLen); // 1..maxLen

    const blockId = color === COLOR_BACKGROUND ? null : nextBlockId();
    for (let bx = 0; bx < len && x + bx < WIDTH; bx++) {
      row[x + bx] = color === COLOR_BACKGROUND
        ? makeCell(COLOR_BACKGROUND)
        : makeCell(color, blockId);
    }
    if (color !== COLOR_BACKGROUND) spawned += len;
    x += len;
  }

  return row;
}

function cloneGridCells(sourceGrid) {
  return sourceGrid.map((cell) => copyCell(cell));
}

function restoreGridFromSnapshot(snapshotGrid) {
  for (let i = 0; i < grid.length; i++) {
    grid[i] = copyCell(snapshotGrid[i]);
  }
}

function rowWouldClearLines(row) {
  if (!row) return false;
  const snapshot = {
    grid: cloneGridCells(grid),
    topLine,
    score,
    hoveredBlock,
    selectedBlock,
    fallingAnimation,
  };
  hoveredBlock = null;
  selectedBlock = null;
  fallingAnimation = null;
  moveBlocksUp();
  const y = HEIGHT - 1;
  for (let x = 0; x < WIDTH; x++) {
    grid[idx(x, y)] = copyCell(row[x]);
  }
  const cleared = settleBoard({ animate: false });
  restoreGridFromSnapshot(snapshot.grid);
  topLine = snapshot.topLine;
  score = snapshot.score;
  hoveredBlock = snapshot.hoveredBlock;
  selectedBlock = snapshot.selectedBlock;
  fallingAnimation = snapshot.fallingAnimation;
  return cleared > 0;
}

function spawnBlocks(options = {}) {
  const { animateSettle = true } = options;
  if (!nextRow) nextRow = generateNextRow();
  let attempts = 0;
  while (rowWouldClearLines(nextRow) && attempts < 20) {
    nextRow = generateNextRow();
    attempts++;
  }
  if (attempts >= 20) {
    nextRow = Array.from({ length: WIDTH }, () => makeCell(COLOR_BACKGROUND));
  }
  moveBlocksUp();
  const y = HEIGHT - 1;
  for (let x = 0; x < WIDTH; x++) {
    grid[idx(x, y)] = copyCell(nextRow[x]);
  }

  settleBoard({ animate: animateSettle });
  nextRow = generateNextRow();
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function defaultCellMargins() {
  return {
    left: CELL_MARGIN,
    right: CELL_MARGIN,
    top: CELL_MARGIN,
    bottom: CELL_MARGIN,
  };
}

function computeGridCellMargins(x, y) {
  const cell = grid[idx(x, y)];
  if (!cell || isEmptyCell(cell) || cell.blockId === null) {
    return defaultCellMargins();
  }
  const isSameBlockNeighbor = (neighborX, neighborY) => {
    if (neighborX < 0 || neighborX >= WIDTH || neighborY < 0 || neighborY >= HEIGHT) {
      return false;
    }
    const neighbor = grid[idx(neighborX, neighborY)];
    if (!neighbor || isEmptyCell(neighbor) || neighbor.blockId === null) return false;
    return neighbor.blockId === cell.blockId;
  };
  return {
    left: isSameBlockNeighbor(x - 1, y) ? 0 : CELL_MARGIN,
    right: isSameBlockNeighbor(x + 1, y) ? 0 : CELL_MARGIN,
    top: isSameBlockNeighbor(x, y - 1) ? 0 : CELL_MARGIN,
    bottom: isSameBlockNeighbor(x, y + 1) ? 0 : CELL_MARGIN,
  };
}

function computeDrawRect(cellX, cellY, margins) {
  const width = Math.max(0, CELL_SIZE - margins.left - margins.right);
  const height = Math.max(0, CELL_SIZE - margins.top - margins.bottom);
  return {
    x: cellX * CELL_SIZE + margins.left,
    y: cellY * CELL_SIZE + margins.top,
    width,
    height,
  };
}

function strokeRectWithMargins(context, rect, margins) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  let hasSegments = false;
  context.beginPath();
  if (margins.top > 0) {
    context.moveTo(rect.x, rect.y);
    context.lineTo(rect.x + rect.width, rect.y);
    hasSegments = true;
  }
  if (margins.right > 0) {
    context.moveTo(rect.x + rect.width, rect.y);
    context.lineTo(rect.x + rect.width, rect.y + rect.height);
    hasSegments = true;
  }
  if (margins.bottom > 0) {
    context.moveTo(rect.x + rect.width, rect.y + rect.height);
    context.lineTo(rect.x, rect.y + rect.height);
    hasSegments = true;
  }
  if (margins.left > 0) {
    context.moveTo(rect.x, rect.y + rect.height);
    context.lineTo(rect.x, rect.y);
    hasSegments = true;
  }
  if (hasSegments) context.stroke();
}

function cellSetFromCells(cells, offset = { x: 0, y: 0 }) {
  const set = new Set();
  if (!cells) return set;
  const offsetX = offset?.x ?? 0;
  const offsetY = offset?.y ?? 0;
  for (const cell of cells) {
    set.add(cellKey(cell.x + offsetX, cell.y + offsetY));
  }
  return set;
}

function computeMarginsForCellInSet(cell, cellSet) {
  if (!cellSet || cellSet.size === 0) return defaultCellMargins();
  const hasNeighbor = (dx, dy) => cellSet.has(cellKey(cell.x + dx, cell.y + dy));
  return {
    left: hasNeighbor(-1, 0) ? 0 : CELL_MARGIN,
    right: hasNeighbor(1, 0) ? 0 : CELL_MARGIN,
    top: hasNeighbor(0, -1) ? 0 : CELL_MARGIN,
    bottom: hasNeighbor(0, 1) ? 0 : CELL_MARGIN,
  };
}

function collectBlockCells(startX, startY, blockId) {
  if (blockId === null || blockId === undefined) return [];
  const toVisit = [{ x: startX, y: startY }];
  const seen = new Set([cellKey(startX, startY)]);
  const cells = [];

  while (toVisit.length > 0) {
    const { x, y } = toVisit.pop();
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) continue;
    const cell = grid[idx(x, y)];
    if (cell.blockId !== blockId) continue;
    cells.push({ x, y });

    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ];
    for (const neighbor of neighbors) {
      const key = cellKey(neighbor.x, neighbor.y);
      if (seen.has(key)) continue;
      seen.add(key);
      toVisit.push(neighbor);
    }
  }

  return cells;
}

function getPointerPosition(evt) {
  const rect = game.getBoundingClientRect();
  const scaleX = game.width / rect.width;
  const scaleY = game.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
  };
}

function trySelectBlock(evt) {
  if (selectedBlock || fallingAnimation) return;
  if (evt.button !== 0) return;
  const pointer = getPointerPosition(evt);
  const cellX = Math.floor(pointer.x / CELL_SIZE);
  const cellY = Math.floor(pointer.y / CELL_SIZE);
  if (cellX < 0 || cellX >= WIDTH || cellY < 0 || cellY >= HEIGHT) return;

  const startCell = grid[idx(cellX, cellY)];
  if (isEmptyCell(startCell)) return;

  const cells = collectBlockCells(cellX, cellY, startCell.blockId);
  if (!cells.length) return;

  for (const cell of cells) {
    grid[idx(cell.x, cell.y)] = makeCell(COLOR_BACKGROUND);
  }

  selectedBlock = {
    color: startCell.color,
    blockId: startCell.blockId,
    baseCells: cells.map((cell) => ({ ...cell })),
    cells: cells.map((cell) => ({ ...cell })),
    offset: 0,
    pointerStartX: pointer.x,
  };

  hoveredBlock = null;
  evt.preventDefault();
}

function canPlaceOffset(baseCells, offset) {
  for (const cell of baseCells) {
    const targetX = cell.x + offset;
    if (targetX < 0 || targetX >= WIDTH) return false;
    if (!isEmptyCell(grid[idx(targetX, cell.y)])) return false;
  }
  return true;
}

function applyOffset(offset) {
  if (!selectedBlock) return;
  if (offset === selectedBlock.offset) return;

  const direction = offset > selectedBlock.offset ? 1 : -1;
  let newOffset = selectedBlock.offset;
  while (newOffset !== offset) {
    const candidate = newOffset + direction;
    if (!canPlaceOffset(selectedBlock.baseCells, candidate)) break;
    newOffset = candidate;
  }

  if (newOffset === selectedBlock.offset) return;

  selectedBlock.offset = newOffset;
  selectedBlock.cells = selectedBlock.baseCells.map((cell) => ({
    x: cell.x + selectedBlock.offset,
    y: cell.y,
  }));
}

function handleDrag(evt) {
  if (!selectedBlock) return;
  const pointer = getPointerPosition(evt);
  const desiredOffset = Math.round((pointer.x - selectedBlock.pointerStartX) / CELL_SIZE);
  applyOffset(desiredOffset);

  evt.preventDefault();
}

function updateHoveredBlock(evt) {
  if (fallingAnimation) {
    hoveredBlock = null;
    return;
  }
  const pointer = getPointerPosition(evt);
  const cellX = Math.floor(pointer.x / CELL_SIZE);
  const cellY = Math.floor(pointer.y / CELL_SIZE);
  if (cellX < 0 || cellX >= WIDTH || cellY < 0 || cellY >= HEIGHT) {
    hoveredBlock = null;
    return;
  }

  const cell = grid[idx(cellX, cellY)];
  if (isEmptyCell(cell)) {
    hoveredBlock = null;
    return;
  }

  const cells = collectBlockCells(cellX, cellY, cell.blockId);
  hoveredBlock = { color: cell.color, blockId: cell.blockId, cells };
}

function clearHover() {
  hoveredBlock = null;
}

function applyGravity(options = {}) {
  const { collectMoves = false } = options;
  if (selectedBlock || fallingAnimation) {
    return { moved: false, moves: [] };
  }
  const moves = collectMoves ? [] : null;
  let movedAny = false;
  let moved;
  do {
    moved = false;
    const processedBlocks = new Set();
    for (let y = HEIGHT - 1; y >= 0; y--) {
      for (let x = 0; x < WIDTH; x++) {
        const cell = grid[idx(x, y)];
        if (isEmptyCell(cell)) continue;
        const blockId = cell.blockId;
        if (blockId === null || processedBlocks.has(blockId)) continue;

        const color = cell.color;
        const cells = collectBlockCells(x, y, blockId);
        if (!cells.length) continue;
        processedBlocks.add(blockId);

        let dropDistance = 0;
        outer: while (true) {
          for (const blockCell of cells) {
            const targetY = blockCell.y + dropDistance + 1;
            if (targetY >= HEIGHT) break outer;
            if (!isEmptyCell(grid[idx(blockCell.x, targetY)])) break outer;
          }
          dropDistance++;
        }

        if (dropDistance === 0) continue;

        for (const blockCell of cells) {
          grid[idx(blockCell.x, blockCell.y)] = makeCell(COLOR_BACKGROUND);
        }
        for (const blockCell of cells) {
          const newY = blockCell.y + dropDistance;
          grid[idx(blockCell.x, newY)] = makeCell(color, blockId);
        }
        if (collectMoves) {
          moves.push({
            cells: cells.map((blockCell) => ({ ...blockCell })),
            color,
            blockId,
            dropDistance,
          });
        }
        moved = true;
        movedAny = true;
      }
    }
  } while (moved);

  return { moved: movedAny, moves: moves || [] };
}

function clearFullLines() {
  let cleared = 0;
  for (let y = 0; y < HEIGHT; y++) {
    let isFull = true;
    for (let x = 0; x < WIDTH; x++) {
      if (isEmptyCell(grid[idx(x, y)])) {
        isFull = false;
        break;
      }
    }
    if (!isFull) continue;
    for (let x = 0; x < WIDTH; x++) {
      grid[idx(x, y)] = makeCell(COLOR_BACKGROUND);
    }
    cleared++;
  }
  if (cleared > 0) hoveredBlock = null;
  return cleared;
}

function settleBoard(options = {}) {
  const { animate = true, onComplete = null } = options;
  if (!animate) {
    let totalCleared = 0;
    while (true) {
      applyGravity();
      const cleared = clearFullLines();
      if (!cleared) break;
      totalCleared += cleared;
    }
    if (totalCleared) score += totalCleared;
    if (onComplete) onComplete();
    return totalCleared;
  }

  if (fallingAnimation) {
    const continuation = () => settleBoard({ animate: true, onComplete });
    fallingAnimation.after.push(continuation);
    return 0;
  }

  const gravityResult = applyGravity({ collectMoves: true });
  if (gravityResult.moves.length > 0) {
    hoveredBlock = null;
    startFallAnimation(gravityResult.moves, {
      strokeStyle: null,
      after: () => settleBoard({ animate: true, onComplete }),
    });
    return 0;
  }

  const cleared = clearFullLines();
  if (cleared > 0) {
    score += cleared;
    return settleBoard({ animate: true, onComplete });
  }

  if (onComplete) onComplete();
  return 0;
}

function finalizePlacement(cells, color, blockId, dropDistance, shouldSpawn) {
  for (const cell of cells) {
    const finalY = cell.y + dropDistance;
    grid[idx(cell.x, finalY)] = makeCell(color, blockId);
  }
  settleBoard({
    onComplete: () => {
      if (shouldSpawn) spawnBlocks();
    },
  });
}

function startFallAnimation(moves, options = {}) {
  if (!moves || moves.length === 0) return;
  const clonedMoves = moves.map((move) => ({
    cells: move.cells.map((cell) => ({ ...cell })),
    color: move.color,
    blockId: move.blockId,
    dropDistance: move.dropDistance,
  }));
  const maxDrop = clonedMoves.reduce((max, move) => Math.max(max, move.dropDistance), 0);
  const duration = Math.max(MIN_FALL_DURATION, maxDrop * FALL_ANIMATION_PER_ROW);
  fallingAnimation = {
    moves: clonedMoves,
    finalize: options.finalize || null,
    after: options.after ? [options.after] : [],
    strokeStyle: Object.prototype.hasOwnProperty.call(options, "strokeStyle")
      ? options.strokeStyle
      : BORDER_SELECTED,
    startTime: null,
    duration,
  };
}

function dropSelectedBlock() {
  if (!selectedBlock) return null;
  const { cells, color, blockId, offset } = selectedBlock;
  const dropDistance = computeDropDistance(cells);
  const movedHorizontally = offset !== 0;

  const placement = {
    cells: cells.map((cell) => ({ ...cell })),
    color,
    blockId,
    dropDistance,
    shouldSpawn: movedHorizontally,
  };

  selectedBlock = null;
  return placement;
}

function computeDropDistance(cells) {
  let dropDistance = 0;
  outer: while (true) {
    for (const cell of cells) {
      const targetY = cell.y + dropDistance + 1;
      if (targetY >= HEIGHT) break outer;
      if (!isEmptyCell(grid[idx(cell.x, targetY)])) break outer;
    }
    dropDistance++;
  }
  return dropDistance;
}

game.addEventListener("mousedown", trySelectBlock);
game.addEventListener("mousemove", updateHoveredBlock);
game.addEventListener("mouseleave", clearHover);
window.addEventListener("mousemove", handleDrag);
window.addEventListener("mouseup", (evt) => {
  if (!selectedBlock) return;
  const placement = dropSelectedBlock();
  if (!placement) return;
  const { dropDistance, shouldSpawn, cells, color, blockId } = placement;
  if (dropDistance === 0) {
    finalizePlacement(cells, color, blockId, dropDistance, shouldSpawn);
  } else {
    startFallAnimation([
      { cells, color, blockId, dropDistance },
    ], {
      finalize: () => finalizePlacement(cells, color, blockId, dropDistance, shouldSpawn),
      strokeStyle: BORDER_SELECTED,
    });
  }
  clearHover();
  evt.preventDefault();
});

function render(timestamp = performance.now()) {
  ctx.clearRect(0, 0, game.width, game.height);
  ctx.fillStyle = CELL_GAP_COLOR;
  ctx.fillRect(0, 0, game.width, HEIGHT * CELL_SIZE);
  ctx.fillRect(0, HEIGHT * CELL_SIZE, game.width, PREVIEW_ROWS * CELL_SIZE);
  const hoveredCells = new Set(
    hoveredBlock ? hoveredBlock.cells.map((cell) => cellKey(cell.x, cell.y)) : []
  );
  const blockLengths = new Map();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const cell = grid[idx(x, y)];
      if (isEmptyCell(cell) || cell.blockId === null) continue;
      blockLengths.set(cell.blockId, (blockLengths.get(cell.blockId) || 0) + 1);
    }
  }
  const animatingBlockIds = fallingAnimation
    ? new Set(
        fallingAnimation.moves
          .map((move) => move.blockId)
          .filter((blockId) => blockId !== null && blockId !== undefined)
      )
    : null;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const cell = grid[idx(x, y)];
      const margins = computeGridCellMargins(x, y);
      const rect = computeDrawRect(x, y, margins);
      const isAnimatingCell =
        animatingBlockIds && cell.blockId !== null && animatingBlockIds.has(cell.blockId);
      if (!isAnimatingCell) {
        ctx.fillStyle = cell.color;
        if (rect.width > 0 && rect.height > 0) {
          ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        }
      } else if (rect.width > 0 && rect.height > 0) {
        ctx.fillStyle = COLOR_BACKGROUND;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      const key = cellKey(x, y);
      const baseBorder = isEmptyCell(cell)
        ? BORDER_DEFAULT
        : borderColorForLength(blockLengths.get(cell.blockId));
      const strokeColor = hoveredCells.has(key) ? BORDER_HOVER : baseBorder;
      if (rect.width > 0 && rect.height > 0 && !isAnimatingCell) {
        ctx.save();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        strokeRectWithMargins(ctx, rect, margins);
        ctx.restore();
      }
      if (isEmptyCell(cell)) {
        ctx.strokeStyle = BORDER_DEFAULT;
        ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
  }
  if (selectedBlock) {
    const ghostDropDistance = computeDropDistance(selectedBlock.cells);
    const length = selectedBlock.baseCells.length;
    const ghostBorderColor = borderColorForLength(length);
    const ghostCells = selectedBlock.cells.map((cell) => ({
      x: cell.x,
      y: cell.y + ghostDropDistance,
    }));
    const ghostCellSet = cellSetFromCells(ghostCells);
    ctx.save();
    ctx.globalAlpha = GHOST_FILL_ALPHA;
    ctx.fillStyle = selectedBlock.color;
    for (const cell of ghostCells) {
      const margins = computeMarginsForCellInSet(cell, ghostCellSet);
      const rect = computeDrawRect(cell.x, cell.y, margins);
      if (rect.width > 0 && rect.height > 0) {
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
    }
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = GHOST_BORDER_ALPHA;
    ctx.strokeStyle = ghostBorderColor;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    for (const cell of ghostCells) {
      const margins = computeMarginsForCellInSet(cell, ghostCellSet);
      const rect = computeDrawRect(cell.x, cell.y, margins);
      strokeRectWithMargins(ctx, rect, margins);
    }
    ctx.restore();
    const selectedCellSet = cellSetFromCells(selectedBlock.cells);
    for (const cell of selectedBlock.cells) {
      const margins = computeMarginsForCellInSet(cell, selectedCellSet);
      const rect = computeDrawRect(cell.x, cell.y, margins);
      ctx.fillStyle = selectedBlock.color;
      if (rect.width > 0 && rect.height > 0) {
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      ctx.save();
      ctx.strokeStyle = BORDER_SELECTED;
      ctx.lineWidth = 2;
      strokeRectWithMargins(ctx, rect, margins);
      ctx.restore();
    }
  }
  const previewY = HEIGHT * CELL_SIZE;
  if (!nextRow) nextRow = generateNextRow();
  const previewLengths = new Map();
  for (const cell of nextRow) {
    if (!cell || isEmptyCell(cell) || cell.blockId === null) continue;
    previewLengths.set(cell.blockId, (previewLengths.get(cell.blockId) || 0) + 1);
  }
  const previewBlockCells = new Map();
  for (let x = 0; x < WIDTH; x++) {
    const cell = nextRow[x];
    if (!cell || isEmptyCell(cell) || cell.blockId === null) continue;
    if (!previewBlockCells.has(cell.blockId)) {
      previewBlockCells.set(cell.blockId, []);
    }
    previewBlockCells.get(cell.blockId).push({ x, y: HEIGHT });
  }
  const previewCellSets = new Map();
  for (const [blockId, cells] of previewBlockCells) {
    previewCellSets.set(blockId, cellSetFromCells(cells));
  }
  ctx.save();
  for (let x = 0; x < WIDTH; x++) {
    const cell = nextRow[x] ?? makeCell(COLOR_BACKGROUND);
    const isBlockCell = !isEmptyCell(cell) && cell.blockId !== null;
    const previewPosition = { x, y: HEIGHT };
    const margins = isBlockCell
      ? computeMarginsForCellInSet(previewPosition, previewCellSets.get(cell.blockId))
      : defaultCellMargins();
    const rect = computeDrawRect(previewPosition.x, previewPosition.y, margins);
    ctx.fillStyle = isBlockCell ? cell.color : COLOR_BACKGROUND;
    ctx.globalAlpha = isBlockCell ? 0.45 : 1;
    if (rect.width > 0 && rect.height > 0) {
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    ctx.globalAlpha = 1;
    const borderColor = isEmptyCell(cell)
      ? BORDER_DEFAULT
      : borderColorForLength(previewLengths.get(cell.blockId));
    if (isBlockCell && rect.width > 0 && rect.height > 0) {
      ctx.save();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2;
      strokeRectWithMargins(ctx, rect, margins);
      ctx.restore();
    }
    if (!isBlockCell) {
      ctx.strokeStyle = BORDER_DEFAULT;
      ctx.strokeRect(x * CELL_SIZE, previewY, CELL_SIZE, CELL_SIZE);
    }
  }
  ctx.restore();
  ctx.save();
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = "16px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Next row", 8, previewY + CELL_SIZE / 2);
  ctx.restore();
  if (fallingAnimation) {
    const anim = fallingAnimation;
    if (anim.startTime === null) anim.startTime = timestamp;
    const elapsed = timestamp - anim.startTime;
    const duration = anim.duration || MIN_FALL_DURATION;
    const progress = Math.min(1, duration ? elapsed / duration : 1);
    ctx.save();
    ctx.lineWidth = 2;
    for (const move of anim.moves) {
      const strokeColor = anim.strokeStyle == null
        ? borderColorForLength(move.cells.length)
        : anim.strokeStyle;
      ctx.fillStyle = move.color;
      ctx.strokeStyle = strokeColor;
      const moveCellSet = cellSetFromCells(move.cells);
      for (const cell of move.cells) {
        const currentY = cell.y + progress * move.dropDistance;
        const margins = computeMarginsForCellInSet(cell, moveCellSet);
        const rect = computeDrawRect(cell.x, currentY, margins);
        if (rect.width > 0 && rect.height > 0) {
          ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
          strokeRectWithMargins(ctx, rect, margins);
        }
      }
    }
    ctx.restore();
    if (progress >= 1) {
      const completedAnimation = anim;
      fallingAnimation = null;
      if (typeof completedAnimation.finalize === "function") {
        completedAnimation.finalize(completedAnimation.moves);
      }
      const callbacks = completedAnimation.after.slice();
      for (const cb of callbacks) cb();
    }
  }
  ctx.save();
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = "20px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText(`Score: ${score}`, game.width - 10, 10);
  ctx.restore();
  requestAnimationFrame(render);
}

for (let i = 0; i < 5; i++) {
  spawnBlocks({ animateSettle: false });
}
render();
