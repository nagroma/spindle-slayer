import { describe, it, expect } from 'vitest';
import { serializeProject, deserializeProject, parseProjectJson, PROJECT_FORMAT, PROJECT_FILE_TYPES, PROJECT_OPEN_PICKER, PROJECT_SAVE_PICKER, writeTextToFileHandle, lompDownloadName } from '../src/persist.js';

const bits = [
  {
    id: 'Magnate_7593',
    name: 'Magnate_7593',
    tool: '7593',
    group: 'compound',
    profile: { type: 'round', r: 1.5 },
  },
];

const model = {
  stock: { type: 'square', length: 34, size: 3.5 },
  placements: [
    {
      id: 'p1',
      bitId: 'Magnate_7593',
      profile: bits[0].profile,
      atLength: 4,
      circularDistance: 1.5,
    },
  ],
};

describe('project JSON', () => {
  it('round-trips stock and cuts by bit id, not by copying the profile', () => {
    const file = serializeProject(model, { selectedId: 'p1' });
    expect(file.format).toBe(PROJECT_FORMAT);
    expect(file.cuts[0].bitId).toBe('Magnate_7593');
    expect(file.cuts[0].diameterAtTip).toBe(3);
    expect(file.cuts[0].profile).toBeUndefined();

    const loaded = deserializeProject(file, bits);
    expect(loaded.missing).toEqual([]);
    expect(loaded.model.stock).toEqual(model.stock);
    expect(loaded.model.placements[0].atLength).toBe(4);
    expect(loaded.model.placements[0].circularDistance).toBe(1.5);
    expect(loaded.model.placements[0].profile).toEqual(bits[0].profile);
    expect(loaded.selectedId).toBe('p1');
  });

  it('accepts diameterAtTip if circularDistance is missing', () => {
    const loaded = deserializeProject(
      {
        format: PROJECT_FORMAT,
        version: 1,
        stock: { type: 'round', length: 20, size: 2 },
        cuts: [{ id: 'p1', bitId: 'Magnate_7593', atLength: 5, diameterAtTip: 1.2 }],
      },
      bits
    );
    expect(loaded.model.placements[0].circularDistance).toBeCloseTo(0.6, 8);
  });

  it('reports bits that are not in the library', () => {
    const loaded = deserializeProject(
      {
        format: PROJECT_FORMAT,
        version: 1,
        stock: { type: 'square', length: 10, size: 2 },
        cuts: [{ id: 'p1', bitId: 'nope', atLength: 1, circularDistance: 0.5 }],
      },
      bits
    );
    expect(loaded.model.placements).toHaveLength(0);
    expect(loaded.missing).toEqual(['nope']);
  });

  it('keeps cut order', () => {
    const two = {
      ...model,
      placements: [
        { ...model.placements[0], id: 'p1', atLength: 4 },
        { ...model.placements[0], id: 'p2', atLength: 8 },
      ],
    };
    const file = serializeProject(two);
    expect(file.cuts.map((c) => c.id)).toEqual(['p1', 'p2']);
    const loaded = deserializeProject(file, bits);
    expect(loaded.model.placements.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(loaded.model.placements.map((p) => p.atLength)).toEqual([4, 8]);
  });

  it('round-trips a hidden cut and omits hidden when it is shown', () => {
    const hidden = {
      ...model,
      placements: [{ ...model.placements[0], hidden: true }],
    };
    const file = serializeProject(hidden);
    expect(file.cuts[0].hidden).toBe(true);
    const loaded = deserializeProject(file, bits);
    expect(loaded.model.placements[0].hidden).toBe(true);

    const shown = serializeProject(model);
    expect(shown.cuts[0].hidden).toBeUndefined();
  });

  it('round-trips a run; omits idle ends when run is off', () => {
    const running = {
      ...model,
      placements: [
        {
          ...model.placements[0],
          run: true,
          endAtLength: 10,
          endCircularDistance: 0.8,
        },
      ],
    };
    const file = serializeProject(running);
    expect(file.cuts[0].run).toBe(true);
    expect(file.cuts[0].endAtLength).toBe(10);
    const loaded = deserializeProject(file, bits);
    expect(loaded.model.placements[0].run).toBe(true);
    expect(loaded.model.placements[0].endAtLength).toBe(10);
    expect(loaded.model.placements[0].endCircularDistance).toBe(0.8);

    const idle = {
      ...model,
      placements: [
        {
          ...model.placements[0],
          run: false,
          endAtLength: 10,
          endCircularDistance: 0.8,
        },
      ],
    };
    const saved = serializeProject(idle);
    expect(saved.cuts[0].run).toBeUndefined();
    expect(saved.cuts[0].endAtLength).toBeUndefined();
  });

  it('treats a file with end poses but no run flag as a run', () => {
    const loaded = deserializeProject(
      {
        format: PROJECT_FORMAT,
        version: 1,
        stock: { type: 'square', length: 34, size: 3.5 },
        cuts: [
          {
            id: 'p1',
            bitId: 'Magnate_7593',
            atLength: 4,
            circularDistance: 1.5,
            endAtLength: 10,
            endCircularDistance: 0.8,
          },
        ],
      },
      bits
    );
    expect(loaded.model.placements[0].run).toBe(true);
    expect(loaded.model.placements[0].endAtLength).toBe(10);
  });

  it('coerces numeric stock fields from JSON strings', () => {
    const loaded = deserializeProject(
      {
        format: PROJECT_FORMAT,
        version: 1,
        stock: { type: 'square', length: '34', size: '3.5' },
        cuts: [{ id: 'p1', bitId: 'Magnate_7593', atLength: 4, circularDistance: 1.5 }],
      },
      bits
    );
    expect(loaded).not.toBeNull();
    expect(loaded.model.stock.length).toBe(34);
    expect(loaded.model.stock.size).toBe(3.5);
  });

  it('unwraps JSON that was stringified twice', () => {
    const file = serializeProject(model, { selectedId: 'p1' });
    const data = parseProjectJson(JSON.stringify(JSON.stringify(file)));
    const loaded = deserializeProject(data, bits);
    expect(loaded.model.placements[0].atLength).toBe(4);
  });

  it('round-trips 2D view and 3D camera, and omits them when absent', () => {
    const sideView = { xMin: -2, yMin: 1, width: 6, height: 20 };
    const camera3d = {
      position: { x: 8, y: -17, z: 4 },
      target: { x: 0, y: -17, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      layout: 'headstock-up-fit',
    };
    const file = serializeProject(model, { selectedId: 'p1', sideView, camera3d });
    expect(file.sideView).toEqual(sideView);
    expect(file.camera3d).toEqual(camera3d);
    const loaded = deserializeProject(file, bits);
    expect(loaded.sideView).toEqual(sideView);
    expect(loaded.camera3d).toEqual(camera3d);

    const bare = serializeProject(model);
    expect(bare.sideView).toBeUndefined();
    expect(bare.camera3d).toBeUndefined();
    const old = deserializeProject(bare, bits);
    expect(old.sideView).toBeNull();
    expect(old.camera3d).toBeNull();
  });

  it('save picker is .lomp only; open picker is .lomp plus All files', () => {
    const exts = PROJECT_FILE_TYPES.flatMap((t) => Object.values(t.accept).flat());
    expect(exts).toEqual(['.lomp']);
    expect(PROJECT_OPEN_PICKER.excludeAcceptAllOption).toBe(false);
    expect(PROJECT_SAVE_PICKER.suggestedName).toBe('spindle.lomp');
    expect(PROJECT_SAVE_PICKER.excludeAcceptAllOption).toBe(false);
    const saveExts = PROJECT_SAVE_PICKER.types.flatMap((t) => Object.values(t.accept).flat());
    expect(saveExts).toEqual(['.lomp']);
  });

  it('turns a typed name into a safe .lomp download filename', () => {
    expect(lompDownloadName('porch-post')).toBe('porch-post.lomp');
    expect(lompDownloadName('porch-post.lomp')).toBe('porch-post.lomp');
    expect(lompDownloadName('folder/foo.lomp')).toBe('foo.lomp');
    expect(lompDownloadName('  ')).toBe('spindle.lomp');
    expect(lompDownloadName('a/b?c')).toBe('b-c.lomp');
  });
});

describe('writeTextToFileHandle', () => {
  it('writes a blob and reports the file size', async () => {
    /** @type {Uint8Array | null} */
    let stored = null;
    const handle = {
      async createWritable() {
        return {
          async write(data) {
            if (data instanceof Blob) stored = new Uint8Array(await data.arrayBuffer());
            else if (data instanceof Uint8Array) stored = data;
            else if (data instanceof ArrayBuffer) stored = new Uint8Array(data);
            else if (data && data.data instanceof Blob) stored = new Uint8Array(await data.data.arrayBuffer());
          },
          async close() {},
          async abort() {},
        };
      },
      async getFile() {
        return { size: stored ? stored.byteLength : 0 };
      },
    };
    const text = '{"format":"legacy-1200-project"}';
    const size = await writeTextToFileHandle(handle, text);
    expect(size).toBe(new TextEncoder().encode(text).length);
    expect(stored).not.toBeNull();
  });
});
