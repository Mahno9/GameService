import type { Poi } from '../api';
import type { ClientState } from '../state/localState';
import { playClick } from '../audio/uiSound';

interface InventoryScreenProps {
  pois: Poi[];
  state: ClientState;
  onClose: () => void;
}

/** Full-screen overlay listing all granted reward items. */
export function InventoryScreen({ pois, state, onClose }: InventoryScreenProps) {
  // Collect items for which rewardGranted is true.
  const items = pois.filter((poi) => {
    const result = state.poiResults[poi.id];
    return result !== undefined && result.rewardGranted;
  });

  return (
    <div className="overlay-screen">
      <div className="overlay-header">
        <span className="overlay-title">Инвентарь</span>
        <button type="button" className="overlay-close-btn" onClick={() => { playClick(); onClose(); }} aria-label="Закрыть">
          ✕
        </button>
      </div>

      {items.length === 0 ? (
        <div className="inventory-empty">Пока пусто. Проходите игры!</div>
      ) : (
        <div className="inventory-list">
          {items.map((poi) => {
            const result = state.poiResults[poi.id];
            // result is guaranteed defined (filtered above), but satisfy TS strictness.
            if (result === undefined) return null;
            const { reward } = poi;
            const itemName =
              (result.won ? reward.nameWin : reward.nameLose || reward.nameWin) || '—';
            const imgSrc =
              reward.imageAsset !== null && reward.imageAsset.startsWith('/')
                ? reward.imageAsset
                : null;

            return (
              <div key={poi.id} className="inventory-card">
                {imgSrc !== null && (
                  <img className="inventory-card-img" src={imgSrc} alt={itemName} />
                )}
                <div className="inventory-card-body">
                  <div className="inventory-card-name">{itemName}</div>
                  <div className="inventory-card-poi">{poi.name}</div>
                  {reward.description.length > 0 && (
                    <div className="inventory-card-desc">{reward.description}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
