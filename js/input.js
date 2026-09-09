// Keyboard state. `justPressed` fires exactly once per keydown so actions like
// jump/dash/attack/weapon-switch don't repeat while the key is held.

const Input = {
  keys: {},
  justPressed: {},

  init() {
    window.addEventListener('keydown', (e) => {
      if (!this.keys[e.code]) this.justPressed[e.code] = true;
      this.keys[e.code] = true;
      // Prevent the page from scrolling on Space/Arrow keys while playing.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    window.addEventListener('blur', () => {
      this.keys = {};
    });

    // Left mouse button is tracked as a synthetic "key" (code 'Mouse0') so
    // it can trigger the same wasPressed-gated actions as a keyboard key —
    // used as an alternate attack input alongside KeyJ.
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (!this.keys.Mouse0) this.justPressed.Mouse0 = true;
      this.keys.Mouse0 = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      this.keys.Mouse0 = false;
    });
  },

  isDown(code) {
    return !!this.keys[code];
  },

  isDownAny(codes) {
    return codes.some((c) => this.keys[c]);
  },

  wasPressed(code) {
    return !!this.justPressed[code];
  },

  wasPressedAny(codes) {
    return codes.some((c) => this.justPressed[c]);
  },

  // Must be called once at the end of every frame, after all systems read input.
  clearFrame() {
    this.justPressed = {};
  },
};

Input.init();
