import type { PoiReward } from '../api';

interface RewardPopupProps {
  reward: PoiReward;
  won: boolean;
  onClaim: () => void;
}

/** Shown once after a game finishes (rewardGranted was false). */
export function RewardPopup({ reward, won, onClaim }: RewardPopupProps) {
  // Title: nameWin on victory, nameLose on defeat (fall back to nameWin if empty).
  const itemName = (won ? reward.nameWin : reward.nameLose || reward.nameWin) || '—';
  const heading = won ? 'Награда' : 'Утешительный приз';

  // Show image only when imageAsset looks like a URL/path.
  const imgSrc =
    reward.imageAsset !== null && reward.imageAsset.startsWith('/')
      ? reward.imageAsset
      : null;

  return (
    <div className="reward-backdrop">
      <div className="reward-card" role="dialog" aria-modal="true" aria-label={heading}>
        <div className="reward-heading">{heading}</div>
        {imgSrc !== null && (
          <img className="reward-img" src={imgSrc} alt={itemName} />
        )}
        <div className="reward-item-name">{itemName}</div>
        {reward.description.length > 0 && (
          <div className="reward-description">{reward.description}</div>
        )}
        <button type="button" className="reward-claim-btn" onClick={onClaim}>
          Забрать
        </button>
      </div>
    </div>
  );
}
