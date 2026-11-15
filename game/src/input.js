// Keyboard and mouse, one place. Pointer lock turns mouse movement into look
// deltas; keys are a live set, and single-fire actions arrive through `pressed`,
// a set the main loop drains once per frame. Nothing here knows what the keys do.
export function createInput(canvas) {
  const input = {
    keys: new Set(),
    pressed: new Set(),
    lookDX: 0,
    lookDY: 0,
    mouseDown: false,
    mouseRightDown: false,
    locked: false,
  };

  function onKeyDown(event) {
    if (event.repeat) return;
    input.keys.add(event.code);
    input.pressed.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function onKeyUp(event) {
    input.keys.delete(event.code);
  }
  function onMouseMove(event) {
    if (!input.locked) return;
    input.lookDX += event.movementX;
    input.lookDY += event.movementY;
  }
  function onMouseDown(event) {
    if (!input.locked) return;
    if (event.button === 0) input.mouseDown = true;
    if (event.button === 2) input.mouseRightDown = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) input.mouseDown = false;
    if (event.button === 2) input.mouseRightDown = false;
  }
  function onLockChange() {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) {
      input.mouseDown = false;
      input.mouseRightDown = false;
    }
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  input.requestLock = () => {
    if (!input.locked) canvas.requestPointerLock();
  };
  input.exitLock = () => {
    if (input.locked) document.exitPointerLock();
  };
  // Called once per frame after the game has read the input.
  input.endFrame = () => {
    input.pressed.clear();
    input.lookDX = 0;
    input.lookDY = 0;
  };
  return input;
}
