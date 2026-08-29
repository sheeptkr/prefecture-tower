import { describe, expect, it } from 'vitest';
import { presentAttack } from '../src/battle/presentation';
import type { PublicAttackCard } from '../src/battle/protocol';

const hiddenCards: PublicAttackCard[] = Array.from({ length: 4 }, (_, index) => ({
  id: `card-${index}`,
  hints: [`ヒント${index}`],
  answerPrefectureName: null,
}));

describe('battle attack presentation', () => {
  it('shows the same four options to the opponent as read-only cards', () => {
    const selector = presentAttack({ phase: 'prefectureAttack', attackPlayer: 1, you: 1, attackCards: hiddenCards });
    const opponent = presentAttack({ phase: 'prefectureAttack', attackPlayer: 1, you: 2, attackCards: hiddenCards });

    expect(selector.title).toBe('相手に送る県を選べ');
    expect(selector.cards).toHaveLength(4);
    expect(selector.cards.every((card) => card.enabled)).toBe(true);
    expect(opponent.visible).toBe(true);
    expect(opponent.title).toBe('対戦相手が選択中');
    expect(opponent.cards.map((card) => card.hints)).toEqual(selector.cards.map((card) => card.hints));
    expect(opponent.cards.every((card) => !card.enabled)).toBe(true);
  });

  it('reveals every prefecture for half a second after selection or timeout', () => {
    const names = ['北海道', '長野県', '長崎県', '沖縄県'];
    const cards = hiddenCards.map((card, index) => ({ ...card, answerPrefectureName: names[index]! }));
    const reveal = presentAttack({ phase: 'prefectureAttackReveal', attackPlayer: 1, you: 2, attackCards: cards });

    expect(reveal.visible).toBe(true);
    expect(reveal.title).toBe('正解発表');
    expect(reveal.cards.every((card) => !card.enabled)).toBe(true);
    expect(reveal.cards.filter((card) => card.revealed).map((card) => card.answerPrefectureName)).toEqual(names);
    expect(reveal.cards.filter((card) => card.dimmed)).toHaveLength(0);
  });
});
