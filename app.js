const PIECE_W = 70;
const PIECE_H = 90;
const BOARD_COLS = 6;
const BOARD_ROWS = 6;
const BOARD_W = PIECE_W * BOARD_COLS;
const BOARD_H = PIECE_H * BOARD_ROWS;

const imageInput = document.querySelector("#imageInput");
const imageLibrary = document.querySelector("#imageLibrary");
const piecesPanel = document.querySelector("#piecesPanel");
const tray = document.querySelector("#tray");
const board = document.querySelector("#board");
const pieceQueue = document.querySelector("#pieceQueue");
const pieceSummary = document.querySelector("#pieceSummary");
const stats = document.querySelector("#stats");
const resetPieces = document.querySelector("#resetPieces");
const autoImportPieces = document.querySelector("#autoImportPieces");
const playModeButton = document.querySelector("#playModeButton");
const exitPlayModeButton = document.querySelector("#exitPlayModeButton");
const exportJsonButton = document.querySelector("#exportJsonButton");
const importJsonInput = document.querySelector("#importJsonInput");
const expandBoardButton = document.querySelector("#expandBoardButton");
const refreshBoardButton = document.querySelector("#refreshBoardButton");
const importAllImages = document.querySelector("#importAllImages");
const clearImages = document.querySelector("#clearImages");

let images = [];
let pieces = [];
let puzzleGroups = [];
let dragState = null;
let activeZ = 1;
let sourceCount = 0;
let isPlayMode = false;
let isResolving = false;
let playSnapshot = null;
let playSession = 0;
let topRowLocked = true;
const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function isTopRowLockedActive() {
  return isPlayMode && topRowLocked;
}

function isTopRowConnectionBlocked(...piecesToCheck) {
  return topRowLocked && piecesToCheck.some((piece) => Number(piece.dataset.boardRow) === 0);
}

function updateLibraryEmptyState() {
  const empty = imageLibrary.querySelector(".empty");
  if (!images.length && !empty) {
    imageLibrary.innerHTML = '<div class="empty">点击“添加图片”，把本地拼图图片加入这里。</div>';
    return;
  }
  if (images.length && empty) empty.remove();
}

function updatePiecesEmptyState() {
  const empty = tray.querySelector(".empty");
  if (!pieces.length && !empty) {
    tray.innerHTML = '<div class="empty">把上方图片拖到这里，编辑器会自动拆成 70 x 90 的拼图碎片。</div>';
    return;
  }
  if (pieces.length && empty) empty.remove();
}

function getBestGrid(width, height) {
  const allowedGrids = [
    { cols: 1, rows: 2 },
    { cols: 2, rows: 1 },
    { cols: 2, rows: 2 },
    { cols: 2, rows: 3 },
    { cols: 3, rows: 2 },
  ];
  const exactCols = width / PIECE_W;
  const exactRows = height / PIECE_H;
  const exactAllowedGrid = allowedGrids.find(
    (grid) => grid.cols === exactCols && grid.rows === exactRows
  );
  if (Number.isInteger(exactCols) && Number.isInteger(exactRows) && exactAllowedGrid) {
    return { cols: exactCols, rows: exactRows, reason: "exact" };
  }

  const ratio = width / height;
  let best = { cols: 1, rows: 1, score: Infinity };

  for (const { cols, rows } of allowedGrids) {
    const gridRatio = (cols * PIECE_W) / (rows * PIECE_H);
    const ratioScore = Math.abs(Math.log(gridRatio / ratio));
    const sizeScore = cols * rows * 0.015;
    const score = ratioScore + sizeScore;
    if (score < best.score) best = { cols, rows, score, reason: "ratio" };
  }

  return best;
}

function makePiece({ imageUrl, imageName, sourceId, sourceW, sourceH, col, row, cols, rows }) {
  const piece = document.createElement("div");
  piece.className = "piece";
  piece.draggable = false;
  piece.dataset.source = imageName;
  piece.dataset.sourceId = sourceId;
  piece.dataset.home = "tray";
  piece.dataset.col = String(col);
  piece.dataset.row = String(row);
  piece.style.setProperty("--source-w", `${sourceW}px`);
  piece.style.setProperty("--source-h", `${sourceH}px`);
  piece.style.setProperty("--bg-x", `${-col * PIECE_W}px`);
  piece.style.setProperty("--bg-y", `${-row * PIECE_H}px`);
  piece.style.backgroundImage = `url("${imageUrl}")`;
  piece.title = `${imageName}：第 ${row + 1} 行，第 ${col + 1} 列，共 ${cols} x ${rows}`;
  piece.addEventListener("pointerdown", startDrag);
  return piece;
}

function makeImageCard(imageItem) {
  const card = document.createElement("div");
  card.className = "image-card";
  card.draggable = true;
  card.dataset.imageId = imageItem.id;
  card.innerHTML = `<img alt=""><span></span>`;
  card.querySelector("img").src = imageItem.url;
  card.querySelector("img").alt = imageItem.name;
  card.querySelector("span").textContent = `${imageItem.name} · ${imageItem.width}x${imageItem.height}`;
  card.title = "拖到下方碎片区进行拆分";
  card.addEventListener("dragstart", (event) => {
    if (imageItem.used) {
      event.preventDefault();
      return;
    }
    card.classList.add("dragging");
    event.dataTransfer.setData("text/plain", imageItem.id);
    event.dataTransfer.effectAllowed = "copy";
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  return card;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => resolve({ image, url: reader.result, name: file.name });
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const { image, url, name } = await loadImage(file);
    const imageItem = {
      id: `image-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      url,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    images.push(imageItem);
    imageLibrary.appendChild(makeImageCard(imageItem));
  }
  imageInput.value = "";
  updateLibraryEmptyState();
  updateStats();
}

async function splitImageToPieces(imageItem) {
  if (imageItem.used) return;
  const grid = getBestGrid(imageItem.width, imageItem.height);
  const sourceW = grid.cols * PIECE_W;
  const sourceH = grid.rows * PIECE_H;
  const fittedUrl = await fitImageToPuzzle(imageItem.url, sourceW, sourceH, grid.cols, grid.rows);
  const sourceId = `source-${++sourceCount}`;
  const pieceCount = grid.cols * grid.rows;
  puzzleGroups.push({ sourceId, pieceCount });
  imageItem.used = true;
  const imageCard = imageLibrary.querySelector(`[data-image-id="${imageItem.id}"]`);
  if (imageCard) {
    imageCard.classList.add("used");
    imageCard.draggable = false;
    imageCard.title = "这张图片已经拆分过";
  }

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const piece = makePiece({
        imageUrl: fittedUrl,
        imageName: imageItem.name,
        sourceId,
        sourceW,
        sourceH,
        col,
        row,
        cols: grid.cols,
        rows: grid.rows,
      });
      piece.dataset.sourceCols = String(grid.cols);
      piece.dataset.sourceRows = String(grid.rows);
      pieces.push(piece);
      tray.appendChild(piece);
    }
  }

  updateStats();
  updatePiecesEmptyState();
}

async function importAllUnusedImages() {
  for (const imageItem of images) {
    if (!imageItem.used) await splitImageToPieces(imageItem);
  }
}

function clearImageLibrary() {
  images = [];
  imageLibrary.innerHTML = "";
  imageInput.value = "";
  updateLibraryEmptyState();
  updateStats();
}

function handlePiecesDragOver(event) {
  if (!Array.from(event.dataTransfer.types).includes("text/plain")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  piecesPanel.classList.add("drop-ready");
}

function handlePiecesDrop(event) {
  event.preventDefault();
  piecesPanel.classList.remove("drop-ready");
  const imageId = event.dataTransfer.getData("text/plain");
  const imageItem = images.find((item) => item.id === imageId);
  if (imageItem) splitImageToPieces(imageItem);
}

function handlePiecesDragLeave(event) {
  if (!piecesPanel.contains(event.relatedTarget)) {
    piecesPanel.classList.remove("drop-ready");
  }
}

function fitImageToPuzzle(url, targetW, targetH, cols, rows) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = reject;
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      const scale = Math.max(targetW / image.naturalWidth, targetH / image.naturalHeight);
      const drawW = image.naturalWidth * scale;
      const drawH = image.naturalHeight * scale;
      const dx = (targetW - drawW) / 2;
      const dy = (targetH - drawH) / 2;
      ctx.drawImage(image, dx, dy, drawW, drawH);
      cleanSourceGridLines(ctx, targetW, targetH, cols, rows);
      resolve(canvas.toDataURL("image/png"));
    };
    image.src = url;
  });
}

function cleanSourceGridLines(ctx, width, height, cols, rows) {
  const edge = 3;
  const imageData = ctx.getImageData(0, 0, width, height);
  const source = new Uint8ClampedArray(imageData.data);

  const copyPixel = (toX, toY, fromX, fromY) => {
    if (toX < 0 || toY < 0 || toX >= width || toY >= height) return;
    if (fromX < 0 || fromY < 0 || fromX >= width || fromY >= height) return;
    const to = (toY * width + toX) * 4;
    const from = (fromY * width + fromX) * 4;
    imageData.data[to] = source[from];
    imageData.data[to + 1] = source[from + 1];
    imageData.data[to + 2] = source[from + 2];
    imageData.data[to + 3] = source[from + 3];
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = col * PIECE_W;
      const y0 = row * PIECE_H;
      for (let i = 0; i < edge; i++) {
        for (let x = x0; x < x0 + PIECE_W; x++) {
          copyPixel(x, y0 + i, x, y0 + edge);
          copyPixel(x, y0 + PIECE_H - 1 - i, x, y0 + PIECE_H - 1 - edge);
        }
        for (let y = y0; y < y0 + PIECE_H; y++) {
          copyPixel(x0 + i, y, x0 + edge, y);
          copyPixel(x0 + PIECE_W - 1 - i, y, x0 + PIECE_W - 1 - edge, y);
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function startDrag(event) {
  const piece = event.currentTarget;
  if (isPlayMode && piece.parentElement !== board) return;
  if (isTopRowLockedActive() && piece.parentElement === board && Number(piece.dataset.boardRow) === 0) return;
  piece.setPointerCapture(event.pointerId);
  const rect = piece.getBoundingClientRect();
  const startCell = piece.parentElement === board ? getBoardCell(piece) : null;
  const groupPieces = isPlayMode && piece.parentElement === board ? getConnectedPieceGroup(piece) : [piece];
  const groupItems = groupPieces.map((groupPiece) => {
    const groupRect = groupPiece.getBoundingClientRect();
    return {
      piece: groupPiece,
      offsetX: event.clientX - groupRect.left,
      offsetY: event.clientY - groupRect.top,
      startCell: getBoardCell(groupPiece),
      startParent: groupPiece.parentElement,
      startNextSibling: groupPiece.nextElementSibling,
    };
  });
  dragState = {
    piece,
    groupItems,
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    scale: getBoardScale(),
    fromBoard: piece.parentElement === board,
    startCell,
    startParent: piece.parentElement,
    startNextSibling: piece.nextElementSibling,
  };
  for (const item of groupItems) {
    document.body.appendChild(item.piece);
    item.piece.classList.add("dragging");
    item.piece.style.zIndex = String(++activeZ);
  }
  moveDraggingPiece(event.clientX, event.clientY);
  document.addEventListener("pointermove", dragMove);
  document.addEventListener("pointerup", endDrag, { once: true });
}

function dragMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  moveDraggingPiece(event.clientX, event.clientY);
  const queueRect = pieceQueue.getBoundingClientRect();
  const insideQueue =
    event.clientX >= queueRect.left &&
    event.clientX <= queueRect.right &&
    event.clientY >= queueRect.top &&
    event.clientY <= queueRect.bottom;
  pieceQueue.classList.toggle("queue-ready", insideQueue);
}

function moveDraggingPiece(clientX, clientY) {
  const { scale } = dragState;
  const dragW = PIECE_W * scale;
  const dragH = PIECE_H * scale;
  for (const item of dragState.groupItems) {
    const piece = item.piece;
    piece.style.width = `${dragW}px`;
    piece.style.height = `${dragH}px`;
    piece.style.backgroundSize = `${Number(piece.style.getPropertyValue("--source-w").replace("px", "")) * scale}px ${Number(piece.style.getPropertyValue("--source-h").replace("px", "")) * scale}px`;
    piece.style.backgroundPosition = `${Number(piece.style.getPropertyValue("--bg-x").replace("px", "")) * scale}px ${Number(piece.style.getPropertyValue("--bg-y").replace("px", "")) * scale}px`;
    piece.style.left = `${clientX - item.offsetX}px`;
    piece.style.top = `${clientY - item.offsetY}px`;
    piece.style.removeProperty("--x");
    piece.style.removeProperty("--y");
  }
}

function endDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const { piece } = dragState;
  const boardRect = board.getBoundingClientRect();
  const queueRect = pieceQueue.getBoundingClientRect();
  const insideBoard =
    event.clientX >= boardRect.left &&
    event.clientX <= boardRect.right &&
    event.clientY >= boardRect.top &&
    event.clientY <= boardRect.bottom;
  const insideQueue =
    !isPlayMode &&
    event.clientX >= queueRect.left &&
    event.clientX <= queueRect.right &&
    event.clientY >= queueRect.top &&
    event.clientY <= queueRect.bottom;

  if (insideQueue) {
    placeInQueue(piece, event.clientY);
  } else if (insideBoard) {
    if (isPlayMode && dragState.groupItems.length > 1) {
      if (!tryPlaceDraggedGroup(event, boardRect)) restoreDraggedGroup();
      finishDrag(piece);
      return;
    }
    const scale = dragState.scale;
    const currentX = (event.clientX - boardRect.left - dragState.offsetX) / scale;
    const currentY = (event.clientY - boardRect.top - dragState.offsetY) / scale;
    const col = Math.max(0, Math.min(BOARD_COLS - 1, Math.round(currentX / PIECE_W)));
    const row = Math.max(0, Math.min(BOARD_ROWS - 1, Math.round(currentY / PIECE_H)));
    if (isTopRowLockedActive() && row === 0) {
      restoreDraggedPiece(piece);
      finishDrag(piece);
      return;
    }
    const occupyingPiece = findPieceAt(col, row, piece);

    if (occupyingPiece && dragState.fromBoard && dragState.startCell) {
      placeOnBoard(occupyingPiece, dragState.startCell.col, dragState.startCell.row);
    } else if (occupyingPiece) {
      returnToTray(occupyingPiece);
    }

    placeOnBoard(piece, col, row);
  } else if (!isPlayMode) {
    restoreDraggedPiece(piece);
  } else if (dragState.startCell) {
    restoreDraggedGroup();
  }

  finishDrag(piece);
}

function finishDrag(piece) {
  for (const item of dragState.groupItems) {
    item.piece.classList.remove("dragging");
    restorePieceSize(item.piece);
  }
  pieceQueue.classList.remove("queue-ready");
  document.removeEventListener("pointermove", dragMove);
  dragState = null;
  updateConnectedBorders();
  if (isPlayMode) resolveCompletedPuzzles();
  updateStats();
}

function restoreDraggedPiece(piece) {
  if (dragState.startCell) {
    placeOnBoard(piece, dragState.startCell.col, dragState.startCell.row);
    return;
  }
  if (dragState.startParent === pieceQueue) {
    pieceQueue.insertBefore(piece, dragState.startNextSibling);
    piece.style.removeProperty("left");
    piece.style.removeProperty("top");
    piece.style.removeProperty("--x");
    piece.style.removeProperty("--y");
    piece.dataset.home = "queue";
    resetPieceBorders(piece);
    return;
  }
  returnToTray(piece);
}

function restoreDraggedGroup() {
  for (const item of dragState.groupItems) {
    if (item.startCell) {
      placeOnBoard(item.piece, item.startCell.col, item.startCell.row);
    } else if (item.startParent === pieceQueue) {
      pieceQueue.insertBefore(item.piece, item.startNextSibling);
      item.piece.style.removeProperty("left");
      item.piece.style.removeProperty("top");
      item.piece.style.removeProperty("--x");
      item.piece.style.removeProperty("--y");
      item.piece.dataset.home = "queue";
      resetPieceBorders(item.piece);
    } else {
      returnToTray(item.piece);
    }
  }
}

function tryPlaceDraggedGroup(event, boardRect) {
  const scale = dragState.scale;
  const activeStart = dragState.startCell;
  const currentX = (event.clientX - boardRect.left - dragState.offsetX) / scale;
  const currentY = (event.clientY - boardRect.top - dragState.offsetY) / scale;
  const targetCol = Math.max(0, Math.min(BOARD_COLS - 1, Math.round(currentX / PIECE_W)));
  const targetRow = Math.max(0, Math.min(BOARD_ROWS - 1, Math.round(currentY / PIECE_H)));
  const groupSet = new Set(dragState.groupItems.map((item) => item.piece));
  const targets = dragState.groupItems.map((item) => {
    const dCol = item.startCell.col - activeStart.col;
    const dRow = item.startCell.row - activeStart.row;
    return {
      piece: item.piece,
      col: targetCol + dCol,
      row: targetRow + dRow,
    };
  });

  const isValid = targets.every((target) => {
    if (target.col < 0 || target.col >= BOARD_COLS || target.row < 0 || target.row >= BOARD_ROWS) return false;
    if (isTopRowLockedActive() && target.row === 0) return false;
    return true;
  });

  if (!isValid) return false;
  const displaced = [];
  const targetCells = new Set(targets.map((target) => `${target.col}:${target.row}`));
  const openStartCells = dragState.groupItems
    .map((item) => item.startCell)
    .filter((cell) => !targetCells.has(`${cell.col}:${cell.row}`));

  for (const target of targets) {
    const occupyingPiece = findPieceAt(target.col, target.row, target.piece);
    if (occupyingPiece && !groupSet.has(occupyingPiece) && !displaced.includes(occupyingPiece)) {
      displaced.push(occupyingPiece);
    }
  }

  if (displaced.length > openStartCells.length) return false;
  for (const target of targets) placeOnBoard(target.piece, target.col, target.row);
  displaced.forEach((displacedPiece, index) => {
    const cell = openStartCells[index];
    placeOnBoard(displacedPiece, cell.col, cell.row);
  });
  return true;
}

function getBoardScale() {
  const rect = board.getBoundingClientRect();
  return rect.width / BOARD_W || 1;
}

function restorePieceSize(piece) {
  piece.style.removeProperty("width");
  piece.style.removeProperty("height");
  piece.style.setProperty("background-size", "var(--source-w) var(--source-h)");
  piece.style.setProperty("background-position", "var(--bg-x) var(--bg-y)");
}

function getBoardCell(piece) {
  return {
    col: Number(piece.dataset.boardCol),
    row: Number(piece.dataset.boardRow),
  };
}

function placeOnBoard(piece, col, row) {
  if (piece.parentElement !== board) board.appendChild(piece);
  piece.style.removeProperty("left");
  piece.style.removeProperty("top");
  piece.style.setProperty("--x", `${col * PIECE_W}px`);
  piece.style.setProperty("--y", `${row * PIECE_H}px`);
  piece.dataset.boardCol = String(col);
  piece.dataset.boardRow = String(row);
  piece.dataset.home = "board";
}

function animatePieceToBoard(piece, col, row) {
  if (piece.parentElement !== board) board.appendChild(piece);
  piece.style.removeProperty("left");
  piece.style.removeProperty("top");
  piece.style.setProperty("--x", `${col * PIECE_W}px`);
  piece.style.setProperty("--y", `${row * PIECE_H}px`);
  piece.dataset.boardCol = String(col);
  piece.dataset.boardRow = String(row);
  piece.dataset.home = "board";
  const fromX = Number(piece.dataset.prevX || col * PIECE_W);
  const fromY = Number(piece.dataset.prevY || row * PIECE_H);
  piece.style.left = `${fromX}px`;
  piece.style.top = `${fromY}px`;
  piece.classList.add("falling");
  piece.getBoundingClientRect();
  piece.style.left = `${col * PIECE_W}px`;
  piece.style.top = `${row * PIECE_H}px`;
  window.setTimeout(() => {
    piece.classList.remove("falling");
    piece.style.removeProperty("left");
    piece.style.removeProperty("top");
  }, 520);
}

function placeInQueue(piece, pointerY) {
  const beforePiece = getQueueInsertBefore(pointerY, piece);
  pieceQueue.insertBefore(piece, beforePiece);
  piece.style.removeProperty("left");
  piece.style.removeProperty("top");
  piece.style.removeProperty("--x");
  piece.style.removeProperty("--y");
  delete piece.dataset.boardCol;
  delete piece.dataset.boardRow;
  piece.dataset.home = "queue";
  resetPieceBorders(piece);
}

function getQueueInsertBefore(pointerY, draggingPiece) {
  const queuePieces = [...pieceQueue.querySelectorAll(".piece")].filter((piece) => piece !== draggingPiece);
  return queuePieces.find((piece) => {
    const rect = piece.getBoundingClientRect();
    return pointerY < rect.top + rect.height / 2;
  }) || null;
}

function autoImportTrayPieces() {
  const trayPieces = shuffle([...tray.querySelectorAll(".piece")]);
  for (const piece of trayPieces) {
    const emptyCell = findFirstEmptyCell();
    if (emptyCell) {
      placeOnBoard(piece, emptyCell.col, emptyCell.row);
    } else {
      placeInQueue(piece);
    }
  }
  updateConnectedBorders();
  updateStats();
  updatePiecesEmptyState();
}

function expandBoard() {
  topRowLocked = false;
  board.classList.add("expanded");
  updateConnectedBorders();
}

function refreshBoard() {
  const looseBoardPieces = [...board.querySelectorAll(".piece")].filter((piece) => !hasAnyCorrectNeighbor(piece));
  const queuePieces = [...pieceQueue.querySelectorAll(".piece")];
  const refreshPieces = shuffle([...looseBoardPieces, ...queuePieces]);
  const anchoredPieces = new Set([...board.querySelectorAll(".piece")].filter((piece) => !looseBoardPieces.includes(piece)));

  for (const piece of refreshPieces) {
    piece.style.removeProperty("left");
    piece.style.removeProperty("top");
    piece.style.removeProperty("--x");
    piece.style.removeProperty("--y");
    delete piece.dataset.boardCol;
    delete piece.dataset.boardRow;
    piece.dataset.home = "queue";
  }

  const openCells = [];
  for (let row = 0; row < BOARD_ROWS; row++) {
    if (isTopRowLockedActive() && row === 0) continue;
    for (let col = 0; col < BOARD_COLS; col++) {
      const occupied = [...anchoredPieces].some(
        (piece) => Number(piece.dataset.boardCol) === col && Number(piece.dataset.boardRow) === row
      );
      if (!occupied) openCells.push({ col, row });
    }
  }
  shuffle(openCells);

  pieceQueue.innerHTML = "";
  for (const piece of refreshPieces) {
    const cell = openCells.shift();
    if (cell) {
      placeOnBoard(piece, cell.col, cell.row);
    } else {
      placeInQueue(piece);
    }
  }

  updateConnectedBorders();
  updateStats();
}

function hasAnyCorrectNeighbor(piece) {
  if (piece.parentElement !== board) return false;
  if (isTopRowConnectionBlocked(piece)) return false;
  const cell = getBoardCell(piece);
  const sourceCol = Number(piece.dataset.col);
  const sourceRow = Number(piece.dataset.row);
  const directions = [
    { dc: 1, dr: 0, sc: 1, sr: 0 },
    { dc: -1, dr: 0, sc: -1, sr: 0 },
    { dc: 0, dr: 1, sc: 0, sr: 1 },
    { dc: 0, dr: -1, sc: 0, sr: -1 },
  ];
  return directions.some((direction) => {
    const neighbor = findPieceAt(cell.col + direction.dc, cell.row + direction.dr, piece);
    if (!neighbor || neighbor.dataset.sourceId !== piece.dataset.sourceId) return false;
    if (isTopRowConnectionBlocked(piece, neighbor)) return false;
    return (
      Number(neighbor.dataset.col) === sourceCol + direction.sc &&
      Number(neighbor.dataset.row) === sourceRow + direction.sr
    );
  });
}

function getConnectedPieceGroup(startPiece) {
  const group = [];
  const visited = new Set();
  const queue = [startPiece];

  while (queue.length) {
    const piece = queue.shift();
    if (visited.has(piece)) continue;
    visited.add(piece);
    group.push(piece);

    for (const neighbor of getCorrectNeighbors(piece)) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  return group;
}

function getCorrectNeighbors(piece) {
  if (piece.parentElement !== board) return [];
  if (isTopRowConnectionBlocked(piece)) return [];
  const cell = getBoardCell(piece);
  const sourceCol = Number(piece.dataset.col);
  const sourceRow = Number(piece.dataset.row);
  const directions = [
    { dc: 1, dr: 0, sc: 1, sr: 0 },
    { dc: -1, dr: 0, sc: -1, sr: 0 },
    { dc: 0, dr: 1, sc: 0, sr: 1 },
    { dc: 0, dr: -1, sc: 0, sr: -1 },
  ];

  return directions
    .map((direction) => {
      const neighbor = findPieceAt(cell.col + direction.dc, cell.row + direction.dr, piece);
      if (!neighbor || neighbor.dataset.sourceId !== piece.dataset.sourceId) return null;
      if (isTopRowConnectionBlocked(piece, neighbor)) return null;
      const isCorrect =
        Number(neighbor.dataset.col) === sourceCol + direction.sc &&
        Number(neighbor.dataset.row) === sourceRow + direction.sr;
      return isCorrect ? neighbor : null;
    })
    .filter(Boolean);
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function enterPlayMode() {
  playSnapshot = createPlaySnapshot();
  playSession++;
  isPlayMode = true;
  document.body.classList.add("play-mode");
  resolveCompletedPuzzles();
}

function exitPlayMode() {
  playSession++;
  isPlayMode = false;
  isResolving = false;
  document.body.classList.remove("play-mode");
  restorePlaySnapshot();
}

async function resolveCompletedPuzzles() {
  if (!isPlayMode) return;
  if (isResolving) return;
  const session = playSession;
  isResolving = true;
  let completed = false;
  const sources = [...new Set(pieces.map((piece) => piece.dataset.sourceId))];
  for (const sourceId of sources) {
    const sourcePieces = pieces.filter((piece) => piece.dataset.sourceId === sourceId);
    if (!sourcePieces.length || sourcePieces.some((piece) => piece.parentElement !== board)) continue;
    if (sourcePieces.some((piece) => isTopRowConnectionBlocked(piece))) continue;

    const placedCols = sourcePieces.map((piece) => Number(piece.dataset.boardCol));
    const placedRows = sourcePieces.map((piece) => Number(piece.dataset.boardRow));
    const sourceCols = sourcePieces.map((piece) => Number(piece.dataset.col));
    const sourceRows = sourcePieces.map((piece) => Number(piece.dataset.row));
    const colOffset = Math.min(...placedCols) - Math.min(...sourceCols);
    const rowOffset = Math.min(...placedRows) - Math.min(...sourceRows);
    const isComplete = sourcePieces.every((piece) => {
      const expectedCol = Number(piece.dataset.col) + colOffset;
      const expectedRow = Number(piece.dataset.row) + rowOffset;
      return Number(piece.dataset.boardCol) === expectedCol && Number(piece.dataset.boardRow) === expectedRow;
    });

    if (isComplete) {
      completed = true;
      removeCompletedPieces(sourcePieces);
    }
  }

  if (completed) {
    await wait(1000);
    if (!isPlayMode || session !== playSession) {
      isResolving = false;
      return;
    }
    settleBoardGravity();
    isResolving = false;
    window.setTimeout(resolveCompletedPuzzles, 560);
    return;
  }
  if (settleBoardGravity()) {
    isResolving = false;
    window.setTimeout(resolveCompletedPuzzles, 560);
    return;
  }
  isResolving = false;
}

function removeCompletedPieces(completedPieces) {
  const session = playSession;
  const completedSet = new Set(completedPieces);
  for (const piece of completedPieces) {
    piece.dataset.clearing = "true";
    piece.classList.add("clearing");
  }
  window.setTimeout(() => {
    if (!isPlayMode || session !== playSession) return;
    for (const piece of completedPieces) piece.remove();
  }, 1000);
  pieces = pieces.filter((piece) => !completedSet.has(piece));
}

function settleBoardGravity() {
  const movedByFall = collapseBoardColumnsAnimated();
  const movedByRefill = refillTopFromQueueAnimated();
  const moved = movedByFall || movedByRefill;
  if (moved) {
    updateConnectedBorders();
    updateStats();
  }
  return moved;
}

function collapseBoardColumnsAnimated() {
  let moved = false;
  for (let col = 0; col < BOARD_COLS; col++) {
    const columnPieces = pieces
      .filter((piece) => piece.parentElement === board && Number(piece.dataset.boardCol) === col)
      .sort((a, b) => Number(b.dataset.boardRow) - Number(a.dataset.boardRow));
    let row = BOARD_ROWS - 1;
    for (const piece of columnPieces) {
      const fromCol = Number(piece.dataset.boardCol);
      const fromRow = Number(piece.dataset.boardRow);
      if (fromCol !== col || fromRow !== row) moved = true;
      piece.dataset.prevX = String(Number(piece.dataset.boardCol) * PIECE_W);
      piece.dataset.prevY = String(Number(piece.dataset.boardRow) * PIECE_H);
      animatePieceToBoard(piece, col, row);
      delete piece.dataset.prevX;
      delete piece.dataset.prevY;
      row--;
    }
  }
  return moved;
}

function refillTopFromQueueAnimated() {
  let moved = false;
  for (let col = 0; col < BOARD_COLS; col++) {
    if (findPieceAt(col, 0)) continue;
    const nextPiece = pieceQueue.querySelector(".piece");
    if (!nextPiece) return moved;
    nextPiece.dataset.prevX = String(col * PIECE_W);
    nextPiece.dataset.prevY = String(-PIECE_H);
    animatePieceToBoard(nextPiece, col, 0);
    delete nextPiece.dataset.prevX;
    delete nextPiece.dataset.prevY;
    moved = true;
  }
  return moved;
}

function findFirstEmptyCell() {
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      if (!findPieceAt(col, row)) return { col, row };
    }
  }
  return null;
}

function returnToTray(piece) {
  tray.appendChild(piece);
  piece.style.removeProperty("left");
  piece.style.removeProperty("top");
  piece.style.removeProperty("--x");
  piece.style.removeProperty("--y");
  delete piece.dataset.boardCol;
  delete piece.dataset.boardRow;
  piece.dataset.home = "tray";
  resetPieceBorders(piece);
}

function findPieceAt(col, row, excludedPiece) {
  return pieces.find(
    (piece) =>
      piece !== excludedPiece &&
      piece.parentElement === board &&
      Number(piece.dataset.boardCol) === col &&
      Number(piece.dataset.boardRow) === row
  );
}

function resetPieceBorders(piece) {
  piece.style.setProperty("--border-top", "#fff");
  piece.style.setProperty("--border-right", "#fff");
  piece.style.setProperty("--border-bottom", "#fff");
  piece.style.setProperty("--border-left", "#fff");
}

function hideBorder(piece, side) {
  piece.style.setProperty(`--border-${side}`, "transparent");
}

function updateConnectedBorders() {
  for (const piece of pieces) resetPieceBorders(piece);

  const directions = [
    { side: "right", opposite: "left", boardCol: 1, boardRow: 0, sourceCol: 1, sourceRow: 0 },
    { side: "bottom", opposite: "top", boardCol: 0, boardRow: 1, sourceCol: 0, sourceRow: 1 },
  ];

  for (const piece of pieces) {
    if (piece.parentElement !== board) continue;
    const cell = getBoardCell(piece);
    const sourceCol = Number(piece.dataset.col);
    const sourceRow = Number(piece.dataset.row);

    for (const direction of directions) {
      const neighbor = findPieceAt(cell.col + direction.boardCol, cell.row + direction.boardRow, piece);
      if (!neighbor || neighbor.dataset.sourceId !== piece.dataset.sourceId) continue;
      if (isTopRowConnectionBlocked(piece, neighbor)) continue;

      const neighborSourceCol = Number(neighbor.dataset.col);
      const neighborSourceRow = Number(neighbor.dataset.row);
      const isOriginalNeighbor =
        neighborSourceCol === sourceCol + direction.sourceCol &&
        neighborSourceRow === sourceRow + direction.sourceRow;

      if (isOriginalNeighbor) {
        hideBorder(piece, direction.side);
        hideBorder(neighbor, direction.opposite);
      }
    }
  }
}

function createPlaySnapshot() {
  return {
    pieces: [...pieces],
    trayOrder: [...tray.querySelectorAll(".piece")],
    queueOrder: [...pieceQueue.querySelectorAll(".piece")],
    boardPieces: [...board.querySelectorAll(".piece")].map((piece) => ({
      piece,
      col: Number(piece.dataset.boardCol),
      row: Number(piece.dataset.boardRow),
    })),
  };
}

function restorePlaySnapshot() {
  if (!playSnapshot) return;
  pieces = [...playSnapshot.pieces];
  tray.innerHTML = "";
  board.innerHTML = "";
  pieceQueue.innerHTML = "";

  for (const piece of playSnapshot.trayOrder) returnToTray(piece);
  for (const { piece, col, row } of playSnapshot.boardPieces) {
    piece.classList.remove("clearing", "falling", "dragging");
    delete piece.dataset.clearing;
    placeOnBoard(piece, col, row);
  }
  for (const piece of playSnapshot.queueOrder) {
    piece.classList.remove("clearing", "falling", "dragging");
    delete piece.dataset.clearing;
    placeInQueue(piece);
  }

  playSnapshot = null;
  updateConnectedBorders();
  updateStats();
  updatePiecesEmptyState();
}

function exportJson() {
  const data = {
    version: 1,
    pieceSize: { width: PIECE_W, height: PIECE_H },
    board: {
      cols: BOARD_COLS,
      rows: BOARD_ROWS,
      lockedRows: topRowLocked ? [0] : [],
      expanded: !topRowLocked,
      pieces: [...board.querySelectorAll(".piece")]
        .map(serializePiece)
        .sort((a, b) => a.board.row - b.board.row || a.board.col - b.board.col),
    },
    queue: {
      pieces: [...pieceQueue.querySelectorAll(".piece")].map((piece, index) => ({
        order: index,
        ...serializePiece(piece),
      })),
    },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "puzzle-layout.json";
  link.click();
  URL.revokeObjectURL(url);
}

function serializePiece(piece) {
  const boardInfo = piece.parentElement === board
    ? { col: Number(piece.dataset.boardCol), row: Number(piece.dataset.boardRow) }
    : null;
  return {
    source: piece.dataset.source,
    sourceId: piece.dataset.sourceId,
    imageUrl: getPieceImageUrl(piece),
    sourceGrid: {
      cols: Number(piece.dataset.sourceCols),
      rows: Number(piece.dataset.sourceRows),
    },
    original: {
      col: Number(piece.dataset.col),
      row: Number(piece.dataset.row),
    },
    board: boardInfo,
  };
}

function getPieceImageUrl(piece) {
  const inlineImage = piece.style.backgroundImage;
  const match = inlineImage.match(/^url\(["']?(.*?)["']?\)$/);
  return match ? match[1] : "";
}

function importJsonFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      importLevelData(data);
    } catch (error) {
      window.alert("导入失败：请选择有效的 Jason/JSON 文件。");
    } finally {
      importJsonInput.value = "";
    }
  };
  reader.readAsText(file);
}

function importLevelData(data) {
  const boardRecords = data?.board?.pieces || [];
  const queueRecords = data?.queue?.pieces || [];
  const existingImageUrls = new Map(
    pieces.map((piece) => [`${piece.dataset.sourceId}:${piece.dataset.col}:${piece.dataset.row}`, getPieceImageUrl(piece)])
  );
  const importedPieces = [];

  tray.innerHTML = "";
  board.innerHTML = "";
  pieceQueue.innerHTML = "";
  pieces = [];
  puzzleGroups = [];
  isResolving = false;
  topRowLocked = !(data?.board?.expanded || data?.board?.lockedRows?.length === 0);
  board.classList.toggle("expanded", !topRowLocked);

  for (const record of boardRecords) {
    const piece = createPieceFromRecord(record, existingImageUrls);
    importedPieces.push(piece);
    placeOnBoard(piece, record.board.col, record.board.row);
  }

  for (const record of queueRecords) {
    const piece = createPieceFromRecord(record, existingImageUrls);
    importedPieces.push(piece);
    placeInQueue(piece);
  }

  pieces = importedPieces;
  rebuildPuzzleGroups();
  updateConnectedBorders();
  updateStats();
  updatePiecesEmptyState();
}

function createPieceFromRecord(record, existingImageUrls) {
  const sourceCols = Number(record.sourceGrid?.cols || 1);
  const sourceRows = Number(record.sourceGrid?.rows || 1);
  const sourceId = record.sourceId || `imported-${++sourceCount}`;
  const col = Number(record.original?.col || 0);
  const row = Number(record.original?.row || 0);
  const imageUrl =
    record.imageUrl ||
    existingImageUrls.get(`${sourceId}:${col}:${row}`) ||
    "";

  if (!imageUrl) {
    throw new Error("Missing image data");
  }

  const piece = makePiece({
    imageUrl,
    imageName: record.source || "imported",
    sourceId,
    sourceW: sourceCols * PIECE_W,
    sourceH: sourceRows * PIECE_H,
    col,
    row,
    cols: sourceCols,
    rows: sourceRows,
  });
  piece.dataset.sourceCols = String(sourceCols);
  piece.dataset.sourceRows = String(sourceRows);
  return piece;
}

function rebuildPuzzleGroups() {
  const groups = new Map();
  for (const piece of pieces) {
    const sourceId = piece.dataset.sourceId;
    if (!groups.has(sourceId)) groups.set(sourceId, new Set());
    groups.get(sourceId).add(`${piece.dataset.col}:${piece.dataset.row}`);
  }
  puzzleGroups = [...groups.entries()].map(([sourceId, cells]) => ({
    sourceId,
    pieceCount: cells.size,
  }));
}

function resetAllPieces() {
  pieces = [];
  puzzleGroups = [];
  tray.innerHTML = "";
  board.innerHTML = "";
  pieceQueue.innerHTML = "";
  sourceCount = 0;
  isResolving = false;
  for (const image of images) image.used = false;
  for (const imageCard of imageLibrary.querySelectorAll(".image-card.used")) {
    imageCard.classList.remove("used");
    imageCard.draggable = true;
    imageCard.title = "拖到下方碎片区进行拆分";
  }
  updateStats();
  updatePiecesEmptyState();
}

function updateStats() {
  const onBoard = pieces.filter((piece) => piece.parentElement === board).length;
  const inQueue = pieces.filter((piece) => piece.parentElement === pieceQueue).length;
  const smallCount = puzzleGroups.filter((group) => group.pieceCount === 2).length;
  const mediumCount = puzzleGroups.filter((group) => group.pieceCount === 4).length;
  const largeCount = puzzleGroups.filter((group) => group.pieceCount === 6).length;
  const otherCount = puzzleGroups.filter((group) => ![2, 4, 6].includes(group.pieceCount)).length;
  pieceSummary.innerHTML = `
    <span>小拼图 ${smallCount} 个</span>
    <span>中拼图 ${mediumCount} 个</span>
    <span>大拼图 ${largeCount} 个</span>
    ${otherCount ? `<span>其他 ${otherCount} 个</span>` : ""}
  `;
  stats.textContent = `单片 70 x 90，画布 6 x 6；图片 ${images.length} 张，碎片 ${pieces.length} 片，画布上 ${onBoard} 片，队列 ${inQueue} 片`;
}

imageInput.addEventListener("change", () => addFiles([...imageInput.files]));
importAllImages.addEventListener("click", importAllUnusedImages);
clearImages.addEventListener("click", clearImageLibrary);
resetPieces.addEventListener("click", resetAllPieces);
autoImportPieces.addEventListener("click", autoImportTrayPieces);
expandBoardButton.addEventListener("click", expandBoard);
refreshBoardButton.addEventListener("click", refreshBoard);
playModeButton.addEventListener("click", enterPlayMode);
exitPlayModeButton.addEventListener("click", exitPlayMode);
exportJsonButton.addEventListener("click", exportJson);
importJsonInput.addEventListener("change", () => importJsonFile(importJsonInput.files[0]));
piecesPanel.addEventListener("dragover", handlePiecesDragOver);
piecesPanel.addEventListener("drop", handlePiecesDrop);
piecesPanel.addEventListener("dragleave", handlePiecesDragLeave);
updateStats();
updateLibraryEmptyState();
updatePiecesEmptyState();
