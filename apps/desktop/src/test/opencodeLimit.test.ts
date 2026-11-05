import { setUiLanguage } from '@/i18n';
import { localized } from '@/lib/stored';
import { agentErrorText } from '@/lib/agents';

// Rust's acp::opencode_turn_error writes this exact English text; the chat shows it in the user's language.
const RUST = "opencode's free model has reached its usage limit. Pick another model in the model menu, or subscribe to OpenCode Go (opencode.ai/go)";

describe("opencode's free usage limit", () => {
  afterEach(() => setUiLanguage('en'));

  it('is shown as is (not as a sign-in problem) and in Indonesian', () => {
    const saved = agentErrorText(RUST, 'opencode', 'en');
    expect(saved).toBe(RUST);
    setUiLanguage('id');
    expect(localized(saved)).toBe('Model gratis opencode sudah mencapai batas pemakaiannya. Pilih model lain di menu model, atau berlangganan OpenCode Go (opencode.ai/go)');
  });
});
