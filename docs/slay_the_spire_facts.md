# Slay the Spire 2 - Verified Engine Facts & Mechanics

This document serves as the single source of truth for all verified Slay the Spire 2 internal engine behaviors, save file conventions, logging signatures, and workout debt engine rules.

---

## 1. Death Detection & Revive Mechanics

### A. Sole Source of Truth: `godot.log`
* Player death detection is **solely based on `godot.log`**.
* The Godot engine writes an explicit death handling event when a player actually dies:
  ```text
  Player (\d+) died, doing death handling
  ```
* Heuristics based on save file HP (`stat.current_hp === 0`) are **strictly prohibited** because StS2 leaves `current_hp` and `max_hp` as `0` inside `player_stats` while sitting on the combat reward screen before reward picking is finished.

### B. Mid-Combat Revives (Fairy in a Bottle & Lizard Tail)
* Mid-combat revives from **Fairy in a Bottle** and **Lizard Tail** do **NOT** count as player deaths.
* When a revive relic or potion triggers:
  1. The player is immediately restored to positive HP.
  2. The Godot engine logs the relic/potion trigger, but does **not** log `Player died, doing death handling`.
  3. The player remains active in combat and can continue playing.
* Therefore, revives do **not** increment the player's death counter ($d_p$), do **not** trigger turn freezing, and do **not** increase workout debt penalties.

### C. Combat Death Penalty Timing Rule
* When a player dies in combat on Floor $X$:
  1. **Turn Freezing**: In multiplayer, the fallen player's turns freeze at the exact round of death ($n_p = \text{death\_turn}$), while surviving allies continue combat.
  2. **Penalty Timing**: The workout counter for Floor $X$ is evaluated using the death count accumulated **prior** to Floor $X$ ($d_p$):
     $$wc_p = n_p \times (2 + d_p) + h_p$$
     The death that occurred during Floor $X$ does **not** retroactively penalize Floor $X$.
  3. **Subsequent Floors**: The death count increments ($d_p \leftarrow d_p + 1$) upon committing Floor $X$, so that higher workout multipliers apply strictly to **subsequent floors** (Floor $X+1$ onward).

---

## 2. Player Max HP Mechanics

* **No Arbitrary Lower Bound**:
  Player Max HP is **not** clamped to $\ge 50$.
* Max HP can be reduced indefinitely through game events, cursed relics, and card transformations, such as:
  - Council of Ghosts / Apparitions (-50% Max HP)
  - Vampires / Bite event (Max HP reduction)
  - Golden Idol / Scrap Ooze / Cursed Bell events
* A player's Max HP can reach single digits or lower until death.

---

## 3. Save File Ingestion & Room Lifecycle

### A. Non-Combat Node Save Lag
* **Combat Nodes**: Appended to `map_point_history` immediately upon combat completion.
* **Non-Combat Nodes (Events, Campfires, Shops, Rest Sites)**: StS2 appends non-combat nodes to `map_point_history` **only after exiting the room**.
* **Real-time Node Entry**: The game records every node coordinate entered in `visited_map_coords` in the current act. The true current floor is:
  $$\text{current\_floor} = \sum_{\text{prior acts}} (\text{nodes in history}) + \text{visited\_map\_coords.length}$$

### B. Combat Reward Stage Lifecycle
* **Active Reward Stage**: Marked by `pre_finished_room.is_pre_finished === true`.
* **Reward Stage Exit**: When the player claims rewards and opens the map to choose the next node, `pre_finished_room` becomes `null`.
* **Early Commit Lock-in**:
  - Players can choose to manually commit their floor debt during the reward stage to do reps immediately.
  - Once committed, subsequent reward screen healing (potions, relics) cannot reduce their debt.
  - If a player does not manually commit, any reward screen healing reduces their pending HP loss ($h_p$), and the floor auto-commits immediately upon moving to the next node.

### C. Game End / Victory Encounter Ingestion Rule
* **Run Unlink on Victory**: When the game is won (`run_status === 'VICTORY'`), StS2 unlinks `current_run.save` and saves the completed run record in `history/<timestamp>.run`.
* **Full Boss Debt Accrual**: The final boss combat encounter accrues full workout counter ($wc$) unconditionally upon victory, regardless of whether players manually committed during the reward screen.
* **No Lost Reps**: The debt ledger automatically records and commits the victory floor's metrics before firing the terminal event, ensuring all reps from the climax battle are tallied in the final session summary.

### D. Start-of-Act Floors & Ancient Room HP Ingestion (Act-Start Healing vs. Health Penalties)
* **Automatic Act-Start Heal**:
  At the beginning of each Act (Act 1 at Neow, Act 2 & Act 3 at Ancient blessing nodes), the StS2 engine automatically applies an act-start heal (`hp_healed`, typically restoring between 28 and 60 HP) to refresh player vitality for the new act.
* **Healing Isolation on Act-Start Floors**:
  In standard combat and event rooms, mid-floor healing reduces net damage taken ($h_p$). However, on start-of-act floors (`map_point_type === 'ancient'`), allowing the automated act-start heal to offset health loss would improperly erase deliberate penalties taken during Neow choices or Ancient blessings.
* **Strict Penalty Accrual Rule**:
  For all start-of-act floors, the automated act-start heal is isolated and ignored. Workout debt ($wc$) strictly accrues for explicit health damage incurred via Godot's recorded `stat.damage_taken`:
  $$wc_{\text{start\_of\_act}} = \max(\text{damage\_taken}, 0)$$
  * **Neow Relic Damage**: Choosing a relic with a starting damage penalty (e.g. *Precarious Shears* inflicting 16 damage taken) accrues exactly $16\ wc$ instead of being erased by the act-start heal.
  * **Ancient Blessing Max HP Sacrifices**: If an Ancient blessing reduces Max HP and that reduction forces Current HP downward, Godot's engine directly logs the truncated Current HP lost into `stat.damage_taken`, which accrues as $wc$. If Current HP was already below the new Max HP, 0 damage is taken and 0 workout debt accrues.
* **Sequential Continuity**:
  Exit HP from the start-of-act floor is recorded as the baseline for Floor 1 of that act, ensuring subsequent event and combat floors continue sequential HP tracking ($\max(\text{HP}_{\text{start}} - \text{HP}_{\text{end}}, 0)$) as intended.


