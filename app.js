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
const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

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
  const exactCols = width / PIECE_W;
  const exactRows = height / PIECE_H;
  if (
    Number.isInteger(exactCols) &&
    Number.isInteger(exactRows) &&
    exactCols >= 1 &&
    exactRows >= 1 &&
    exactCols <= BOARD_COLS &&
    exactRows <= BOARD_ROWS
  ) {
    return { cols: exactCols, rows: exactRows, reason: "exact" };
  }

  const ratio = width / height;
  let best = { cols: 1, rows: 1, score: Infinity };

  for (let cols = 1; cols <= BOARD_COLS; cols++) {
    for (let rows = 1; rows <= BOARD_ROWS; rows++) {
      const gridRatio = (cols * PIECE_W) / (rows * PIECE_H);
      const ratioScore = Math.abs(Math.log(gridRatio / ratio));
      const sizeScore = cols * rows * 0.015;
      const score = ratioScore + sizeScore;
      if (score < best.score) best = { cols, rows, score, reason: "ratio" };
    }
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
  piece.setPointerCapture(event.pointerId);
  const rect = piece.getBoundingClientRect();
  const startCell = piece.parentElement === board ? getBoardCell(piece) : null;
  dragState = {
    piece,
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    scale: getBoardScale(),
    fromBoard: piece.parentElement === board,
    startCell,
  };
  document.body.appendChild(piece);
  piece.classList.add("dragging");
  piece.style.zIndex = String(++activeZ);
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
  const { piece, offsetX, offsetY, scale } = dragState;
  const dragW = PIECE_W * scale;
  const dragH = PIECE_H * scale;
  piece.style.width = `${dragW}px`;
  piece.style.height = `${dragH}px`;
  piece.style.backgroundSize = `${Number(piece.style.getPropertyValue("--source-w").replace("px", "")) * scale}px ${Number(piece.style.getPropertyValue("--source-h").replace("px", "")) * scale}px`;
  piece.style.backgroundPosition = `${Number(piece.style.getPropertyValue("--bg-x").replace("px", "")) * scale}px ${Number(piece.style.getPropertyValue("--bg-y").replace("px", "")) * scale}px`;
  piece.style.left = `${clientX - offsetX}px`;
  piece.style.top = `${clientY - offsetY}px`;
  piece.style.removeProperty("--x");
  piece.style.removeProperty("--y");
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
    const scale = dragState.scale;
    const currentX = (event.clientX - boardRect.left - dragState.offsetX) / scale;
    const currentY = (event.clientY - boardRect.top - dragState.offsetY) / scale;
    const col = Math.max(0, Math.min(BOARD_COLS - 1, Math.round(currentX / PIECE_W)));
    const row = Math.max(0, Math.min(BOARD_ROWS - 1, Math.round(currentY / PIECE_H)));
    const occupyingPiece = findPieceAt(col, row, piece);

    if (occupyingPiece && dragState.fromBoard && dragState.startCell) {
      placeOnBoard(occupyingPiece, dragState.startCell.col, dragState.startCell.row);
    } else if (occupyingPiece) {
      returnToTray(occupyingPiece);
    }

    placeOnBoard(piece, col, row);
  } else if (!isPlayMode) {
    returnToTray(piece);
  } else if (dragState.startCell) {
    placeOnBoard(piece, dragState.startCell.col, dragState.startCell.row);
  }

  piece.classList.remove("dragging");
  restorePieceSize(piece);
  pieceQueue.classList.remove("queue-ready");
  document.removeEventListener("pointermove", dragMove);
  dragState = null;
  updateConnectedBorders();
  if (isPlayMode) resolveCompletedPuzzles();
  updateStats();
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
  const trayPieces = [...tray.querySelectorAll(".piece")];
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

function enterPlayMode() {
  isPlayMode = true;
  document.body.classList.add("play-mode");
  resolveCompletedPuzzles();
}

function exitPlayMode() {
  isPlayMode = false;
  document.body.classList.remove("play-mode");
}

async function resolveCompletedPuzzles() {
  if (isResolving) return;
  isResolving = true;
  let completed = false;
  const sources = [...new Set(pieces.map((piece) => piece.dataset.sourceId))];
  for (const sourceId of sources) {
    const sourcePieces = pieces.filter((piece) => piece.dataset.sourceId === sourceId);
    if (!sourcePieces.length || sourcePieces.some((piece) => piece.parentElement !== board)) continue;

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
  const completedSet = new Set(completedPieces);
  for (const piece of completedPieces) {
    piece.dataset.clearing = "true";
    piece.classList.add("clearing");
  }
  window.setTimeout(() => {
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
playModeButton.addEventListener("click", enterPlayMode);
exitPlayModeButton.addEventListener("click", exitPlayMode);
piecesPanel.addEventListener("dragover", handlePiecesDragOver);
piecesPanel.addEventListener("drop", handlePiecesDrop);
piecesPanel.addEventListener("dragleave", handlePiecesDragLeave);
updateStats();
updateLibraryEmptyState();
updatePiecesEmptyState();
