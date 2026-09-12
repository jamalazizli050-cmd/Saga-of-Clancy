// Keyboard state. `justPressed` fires exactly once per keydown so actions like
// jump/dash/attack/weapon-switch don't repeat while the key is held.

// MouseEvent.button -> the synthetic key code it's stored under. Button 1
// (middle) is deliberately absent: nothing binds it, and claiming it would
// only break autoscroll for no gain.
const MOUSE_BUTTON_CODES = { 0: 'Mouse0', 2: 'Mouse2' };

const Input = {
  keys: {},
  justPressed: {},

  init() {
    window.addEventListener('keydown', (e) => {
      // Audio can't exist before the user has interacted with the page
      // (autoplay policy), so this and the mousedown handler below are where
      // the whole sound layer comes to life — see audio.js. Safe to call on
      // every input: the first one builds the context, later ones only
      // resume it if the browser suspended it.
      Sfx.unlock();
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

    // Mouse buttons are tracked as synthetic "keys" ('Mouse0' left, 'Mouse2'
    // right) so they trigger the same wasPressed-gated actions a keyboard key
    // does. Left is melee attack (alongside KeyJ), right fires the bow — see
    // Player.update()'s two independent attack blocks.
    window.addEventListener('mousedown', (e) => {
      Sfx.unlock(); // see the keydown handler above
      const code = MOUSE_BUTTON_CODES[e.button];
      if (!code) return;
      if (!this.keys[code]) this.justPressed[code] = true;
      this.keys[code] = true;
    });
    window.addEventListener('mouseup', (e) => {
      const code = MOUSE_BUTTON_CODES[e.button];
      if (!code) return;
      this.keys[code] = false;
    });
    // Right-click is a game action, so the browser's own context menu must
    // never open on it — without this, every bow shot pops the menu over the
    // canvas and swallows the following clicks.
    window.addEventListener('contextmenu', (e) => e.preventDefault());
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
