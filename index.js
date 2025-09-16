const game = /** @type {HTMLCanvasElement} */(document.getElementById("game"));
if (!game) throw new Error("no canvas");
const ctx  = /** @type {CanvasRenderingContext2D} */(game.getContext("2d"));

const WIDTH = 10, HEIGHT = 20, CELL_SIZE = 35;
const COLOR_BACKGROUND = "black";
const MAX_BLOCK_SPAWN = 7;
const BORDER_DEFAULT = "#3a3a3a";
const BORDER_HOVER = "#f5d742";
const BORDER_SELECTED = "#5de6ff";
const PREVIEW_ROWS = 1;
const CELL_MARGIN = 4;
const CELL_GAP_COLOR = "#aa0000";
const GHOST_FILL_ALPHA = 0.28;
const GHOST_BORDER_ALPHA = 0.75;
const BORDER_COLORS_BY_LENGTH = {
  1: "#f94144",
  2: "#f8961e",
  3: "#43aa8b",
  4: "#577590",
  default: "#d9d9d9",
};
const FALL_ANIMATION_PER_ROW = 120; // ms per row drop
const MIN_FALL_DURATION = 120;
game.width = WIDTH * CELL_SIZE;
game.height = (HEIGHT + PREVIEW_ROWS) * CELL_SIZE;

const idx = (x, y) => y * WIDTH + x;

const DEFAULT_OVERLAY_LIGHT = "rgba(255, 255, 255, 0.45)";
const DEFAULT_OVERLAY_DARK = "rgba(0, 0, 0, 0.4)";

const LENGTH_OVERLAY_DRAWERS = {
  1(ctx, size, colors) {
    const radius = size / 6;
    const positions = [
      [size * 0.3, size * 0.3],
      [size * 0.7, size * 0.45],
      [size * 0.45, size * 0.72],
    ];
    ctx.fillStyle = colors.lightColor;
    for (const [x, y] of positions) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    const innerRadius = radius * 0.55;
    ctx.fillStyle = colors.darkColor;
    for (const [x, y] of positions) {
      ctx.beginPath();
      ctx.arc(x, y, innerRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  2(ctx, size, colors) {
    const stripeCount = 3;
    const spacing = size / (stripeCount + 1);
    const lineWidth = Math.max(2, size / 10);
    ctx.lineCap = "round";
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = colors.lightColor;
    for (let i = 1; i <= stripeCount; i++) {
      const y = i * spacing;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    ctx.strokeStyle = colors.darkColor;
    for (let i = 1; i < stripeCount; i++) {
      const y = i * spacing + spacing / 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
  },
  3(ctx, size, colors) {
    const stripeCount = 3;
    const spacing = size / (stripeCount + 1);
    const lineWidth = Math.max(2, size / 10);
    ctx.lineCap = "round";
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = colors.lightColor;
    for (let i = 1; i <= stripeCount; i++) {
      const x = i * spacing;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    ctx.strokeStyle = colors.darkColor;
    for (let i = 1; i < stripeCount; i++) {
      const x = i * spacing + spacing / 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
  },
  4(ctx, size, colors) {
    const spacing = size / 3;
    const lineWidth = Math.max(1.5, size / 14);
    ctx.lineCap = "round";
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = colors.lightColor;
    for (let offset = -size; offset <= size; offset += spacing) {
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + size, size);
      ctx.stroke();
    }
    ctx.strokeStyle = colors.darkColor;
    for (let offset = 0; offset <= size * 2; offset += spacing) {
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset - size, size);
      ctx.stroke();
    }
  },
};

function drawLengthOverlay(ctx, length, drawX, drawY, size, options = {}) {
  if (!length || size <= 0) return;
  const drawer = LENGTH_OVERLAY_DRAWERS[length];
  if (!drawer) return;
  const {
    lightColor = DEFAULT_OVERLAY_LIGHT,
    darkColor = DEFAULT_OVERLAY_DARK,
    alpha = 1,
  } = options;
  ctx.save();
  ctx.translate(drawX, drawY);
  ctx.globalAlpha *= alpha;
  drawer(ctx, size, { lightColor, darkColor });
  ctx.restore();
}

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
const colors = ["green", "white", "blue", COLOR_BACKGROUND];

let topLine = -1;
let selectedBlock = null;
let hoveredBlock = null;
let score = 0;
let nextRow = null;
let selectionMoved = false;
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
  selectionMoved = false;
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
  selectionMoved = true;
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
  selectionMoved = false;
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
  const { cells, color, blockId } = selectedBlock;
  const dropDistance = computeDropDistance(cells);

  const placement = {
    cells: cells.map((cell) => ({ ...cell })),
    color,
    blockId,
    dropDistance,
    shouldSpawn: selectionMoved,
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
  const innerSize = Math.max(0, CELL_SIZE - CELL_MARGIN * 2);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const cell = grid[idx(x, y)];
      const drawX = x * CELL_SIZE + CELL_MARGIN;
      const drawY = y * CELL_SIZE + CELL_MARGIN;
      const isAnimatingCell =
        animatingBlockIds && cell.blockId !== null && animatingBlockIds.has(cell.blockId);
      if (!isAnimatingCell) {
        ctx.fillStyle = cell.color;
        if (innerSize > 0) {
          ctx.fillRect(drawX, drawY, innerSize, innerSize);
          const blockLength = blockLengths.get(cell.blockId);
          if (blockLength >= 1 && blockLength <= 4) {
            drawLengthOverlay(ctx, blockLength, drawX, drawY, innerSize);
          }
        }
      } else if (innerSize > 0) {
        ctx.fillStyle = COLOR_BACKGROUND;
        ctx.fillRect(drawX, drawY, innerSize, innerSize);
      }
      const key = cellKey(x, y);
      const baseBorder = isEmptyCell(cell)
        ? BORDER_DEFAULT
        : borderColorForLength(blockLengths.get(cell.blockId));
      const strokeColor = hoveredCells.has(key) ? BORDER_HOVER : baseBorder;
      if (innerSize > 0 && !isAnimatingCell) {
        ctx.save();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(drawX, drawY, innerSize, innerSize);
        ctx.restore();
      }
      ctx.strokeStyle = BORDER_DEFAULT;
      ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }
  if (selectedBlock) {
    const selectedLength = selectedBlock.baseCells.length;
    const ghostDropDistance = computeDropDistance(selectedBlock.cells);
    const ghostBorderColor = borderColorForLength(selectedLength);
    ctx.save();
    ctx.globalAlpha = GHOST_FILL_ALPHA;
    ctx.fillStyle = selectedBlock.color;
    for (const cell of selectedBlock.cells) {
      const drawX = cell.x * CELL_SIZE + CELL_MARGIN;
      const drawY = (cell.y + ghostDropDistance) * CELL_SIZE + CELL_MARGIN;
      if (innerSize > 0) {
        ctx.fillRect(drawX, drawY, innerSize, innerSize);
        drawLengthOverlay(ctx, selectedLength, drawX, drawY, innerSize, {
          lightColor: "rgba(255, 255, 255, 0.7)",
          darkColor: "rgba(0, 0, 0, 0.65)",
        });
      }
    }
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = GHOST_BORDER_ALPHA;
    ctx.strokeStyle = ghostBorderColor;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    for (const cell of selectedBlock.cells) {
      const drawX = cell.x * CELL_SIZE + CELL_MARGIN;
      const drawY = (cell.y + ghostDropDistance) * CELL_SIZE + CELL_MARGIN;
      if (innerSize > 0) ctx.strokeRect(drawX, drawY, innerSize, innerSize);
    }
    ctx.restore();
    for (const cell of selectedBlock.cells) {
      const drawX = cell.x * CELL_SIZE + CELL_MARGIN;
      const drawY = cell.y * CELL_SIZE + CELL_MARGIN;
      ctx.fillStyle = selectedBlock.color;
      if (innerSize > 0) {
        ctx.fillRect(drawX, drawY, innerSize, innerSize);
        drawLengthOverlay(ctx, selectedLength, drawX, drawY, innerSize, {
          lightColor: "rgba(255, 255, 255, 0.5)",
          darkColor: "rgba(0, 0, 0, 0.45)",
        });
      }
      ctx.save();
      ctx.strokeStyle = BORDER_SELECTED;
      ctx.lineWidth = 2;
      if (innerSize > 0) ctx.strokeRect(drawX, drawY, innerSize, innerSize);
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
  ctx.save();
  for (let x = 0; x < WIDTH; x++) {
    const cell = nextRow[x] ?? makeCell(COLOR_BACKGROUND);
    const drawX = x * CELL_SIZE + CELL_MARGIN;
    const drawY = previewY + CELL_MARGIN;
    if (isEmptyCell(cell)) {
      ctx.fillStyle = COLOR_BACKGROUND;
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = cell.color;
      ctx.globalAlpha = 0.45;
    }
    if (innerSize > 0) {
      ctx.fillRect(drawX, drawY, innerSize, innerSize);
      if (!isEmptyCell(cell)) {
        const previewLength = previewLengths.get(cell.blockId);
        if (previewLength >= 1 && previewLength <= 4) {
          drawLengthOverlay(ctx, previewLength, drawX, drawY, innerSize, {
            lightColor: "rgba(255, 255, 255, 0.65)",
            darkColor: "rgba(0, 0, 0, 0.55)",
          });
        }
      }
    }
    ctx.globalAlpha = 1;
    const borderColor = isEmptyCell(cell)
      ? BORDER_DEFAULT
      : borderColorForLength(previewLengths.get(cell.blockId));
    if (!isEmptyCell(cell) && innerSize > 0) {
      ctx.save();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(drawX, drawY, innerSize, innerSize);
      ctx.restore();
    }
    ctx.strokeStyle = BORDER_DEFAULT;
    ctx.strokeRect(x * CELL_SIZE, previewY, CELL_SIZE, CELL_SIZE);
  }
  ctx.restore();
  ctx.save();
  ctx.fillStyle = "white";
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
      for (const cell of move.cells) {
        const currentY = cell.y + progress * move.dropDistance;
        const drawX = cell.x * CELL_SIZE + CELL_MARGIN;
        const drawY = currentY * CELL_SIZE + CELL_MARGIN;
        if (innerSize > 0) {
          ctx.fillRect(drawX, drawY, innerSize, innerSize);
          const moveLength = move.cells.length;
          if (moveLength >= 1 && moveLength <= 4) {
            drawLengthOverlay(ctx, moveLength, drawX, drawY, innerSize);
          }
        }
        if (innerSize > 0) ctx.strokeRect(drawX, drawY, innerSize, innerSize);
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
  ctx.fillStyle = "white";
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
