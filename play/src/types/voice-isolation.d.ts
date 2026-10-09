// "voiceIsolation" (Media Capture Extensions) is newer than this project's TypeScript DOM types.
interface MediaTrackSupportedConstraints {
    voiceIsolation?: boolean;
}

interface MediaTrackConstraintSet {
    voiceIsolation?: ConstrainBoolean;
}

interface MediaTrackSettings {
    voiceIsolation?: boolean;
}
