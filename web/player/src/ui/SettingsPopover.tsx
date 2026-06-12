import { playClick } from '../audio/uiSound';
import { localState } from '../state/localState';
import { useI18n, type Lang } from '../i18n/index';

interface SettingsPopoverProps {
  currentLang: string;
  onClose: () => void;
}

/**
 * Small settings popover for language switching.
 * Rendered as an absolute overlay anchored to the ⚙️ button.
 */
export function SettingsPopover({ currentLang, onClose }: SettingsPopoverProps) {
  const t = useI18n();

  function switchLang(lang: Lang) {
    playClick();
    localState.setLang(lang);
    onClose();
  }

  return (
    <div className="settings-popover-backdrop" onClick={() => { playClick(); onClose(); }}>
      <div className="settings-popover" onClick={(e) => e.stopPropagation()}>
        <div className="settings-popover-title">{t('settings.title')}</div>
        <div className="settings-lang-btns">
          <button
            type="button"
            className={`settings-lang-btn${currentLang === 'ru' ? ' settings-lang-btn-active' : ''}`}
            onClick={() => switchLang('ru')}
          >
            {t('settings.lang.ru')}
          </button>
          <button
            type="button"
            className={`settings-lang-btn${currentLang === 'en' ? ' settings-lang-btn-active' : ''}`}
            onClick={() => switchLang('en')}
          >
            {t('settings.lang.en')}
          </button>
        </div>
      </div>
    </div>
  );
}
