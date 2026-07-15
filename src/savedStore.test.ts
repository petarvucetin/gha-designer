import { beforeEach, describe, expect, it } from 'vitest';
import { useSaved } from './savedStore';

beforeEach(() => {
  useSaved.setState({ saved: [] });
});

describe('useSaved', () => {
  it('addSaved appends a new item', () => {
    useSaved.getState().addSaved({ name: 'checkout', ref: 'actions/checkout@v4', kind: 'action' });
    expect(useSaved.getState().saved).toHaveLength(1);
    expect(useSaved.getState().saved[0]).toMatchObject({ name: 'checkout', ref: 'actions/checkout@v4', kind: 'action' });
  });

  it('addSaved with an existing ref (case-insensitive) does not duplicate and moves it to front', () => {
    useSaved.getState().addSaved({ name: 'checkout', ref: 'actions/checkout@v4', kind: 'action' });
    const firstId = useSaved.getState().saved[0].id;
    useSaved.getState().addSaved({ name: 'setup-node', ref: 'actions/setup-node@v4', kind: 'action' });
    useSaved.getState().addSaved({ name: 'Checkout', ref: 'ACTIONS/CHECKOUT@v4', kind: 'action' });

    const { saved } = useSaved.getState();
    expect(saved).toHaveLength(2);
    expect(saved[0].id).toBe(firstId);
    expect(saved[0].name).toBe('Checkout');
    expect(saved[0].ref).toBe('actions/checkout@v4');
    expect(saved.map((s) => s.ref)).toEqual(['actions/checkout@v4', 'actions/setup-node@v4']);
  });

  it('removeSaved removes by id', () => {
    useSaved.getState().addSaved({ name: 'checkout', ref: 'actions/checkout@v4', kind: 'action' });
    useSaved.getState().addSaved({ name: 'setup-node', ref: 'actions/setup-node@v4', kind: 'action' });
    const idToRemove = useSaved.getState().saved.find((s) => s.ref === 'actions/checkout@v4')!.id;

    useSaved.getState().removeSaved(idToRemove);

    const { saved } = useSaved.getState();
    expect(saved).toHaveLength(1);
    expect(saved[0].ref).toBe('actions/setup-node@v4');
  });
});
