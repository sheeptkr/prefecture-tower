import type { BattleView, PublicAttackCard } from './protocol';

export type PresentedAttackCard = PublicAttackCard & {
  enabled: boolean;
  revealed: boolean;
  dimmed: boolean;
};

export type AttackPresentation = {
  visible: boolean;
  title: string;
  cards: PresentedAttackCard[];
};

export function presentAttack(view: Pick<BattleView, 'phase' | 'attackPlayer' | 'you' | 'attackCards'>): AttackPresentation {
  const selecting = view.phase === 'prefectureAttack';
  const revealing = view.phase === 'prefectureAttackReveal';
  const visible = selecting || revealing;
  const canSelect = selecting && view.attackPlayer === view.you;
  return {
    visible,
    title: revealing ? '正解発表' : canSelect ? '相手に送る県を選べ' : '対戦相手が選択中',
    cards: visible ? view.attackCards.map((card) => ({
      ...card,
      enabled: canSelect,
      revealed: card.answerPrefectureName !== null,
      dimmed: revealing && card.answerPrefectureName === null,
    })) : [],
  };
}
