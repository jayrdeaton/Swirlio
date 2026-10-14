// The version of the how-to-play flow (see @tastic/hud/guide) this build teaches. Bump it ONLY when a
// gesture or controls change would leave the current cards teaching something wrong: every player,
// new and existing, sees the guide once more after a bump. A copy tweak or an added tip is not a
// reason to.
export const GUIDE_VERSION = 1

// Its own AsyncStorage key, like PhotosensitivityWarning's, rather than a useSwirlSettings field: it
// isn't a setting, and keeping it out of that store means Reset All can never re-show the guide.
export const GUIDE_STORAGE_KEY = 'guide-version-seen'
