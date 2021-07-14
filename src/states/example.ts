import aceEvent, { AceEvent } from "@wowts/ace_event-3.0";
import { AceModule } from "@wowts/tsaddon";
import { OvaleClass } from "../Ovale";
import { DebugTools, Tracer } from "../engine/debug";

export class Example {
    private module: AceModule & AceEvent;
    private tracer: Tracer;

    constructor(ovale: OvaleClass, debug: DebugTools) {
        this.module = ovale.createModule(
            "Example",
            this.onEnable,
            this.onDisable,
            aceEvent
        );
        /* Create a module-specific toggle for debugging output in the
         * chat window from calls to this.tracer.debug(...).
         */
        this.tracer = debug.create(this.module.GetName());
    }

    private onEnable = () => {
        /* Called to initialize and enable the module.
         * Register events, hook functions, create frames, and get
         * information from the game client after PLAYER_LOGIN fires.
         */
        this.module.RegisterEvent(
            "PLAYER_ENTERING_WORLD",
            this.onPlayerEnteringWorld
        );
    };

    private onDisable = () => {
        /* Called to manaully disable the module.
         * Unregister events, unhook functions, and hide frames.
         */
        this.module.UnregisterEvent("PLAYER_ENTERING_WORLD");
    };

    private onPlayerEnteringWorld = (event: string) => {
        // Event handler for PLAYER_ENTERING_WORLD event
        this.tracer.debug(event);
    };
}
