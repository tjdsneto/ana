import React from "react"
import { Composition } from "remotion"
import { Comp, calcMeta } from "./Comp"

// One composition; its size + duration come from the injected HTML via calculateMetadata (the defaults
// below are placeholders Remotion requires at registration).
export const Root: React.FC = () => (
	<Composition
		id="mg"
		component={Comp}
		calculateMetadata={calcMeta}
		defaultProps={{ html: "", fps: 30 }}
		durationInFrames={90}
		fps={30}
		width={1280}
		height={720}
	/>
)
