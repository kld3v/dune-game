import { useGameStore } from '../store/gameStore'

export default function HUD() {
  const mode = useGameStore(s => s.mode)
  const spice = useGameStore(s => s.spice)
  const water = useGameStore(s => s.water)
  const hallucinationLevel = useGameStore(s => s.hallucinationLevel)
  const thumping = useGameStore(s => s.thumping)
  const thumpProgress = useGameStore(s => s.thumpProgress)
  const showControls = useGameStore(s => s.showControls)
  const toggleControls = useGameStore(s => s.toggleControls)

  const hallucinationText = [
    '',
    'The spice flows...',
    'He who controls the spice...',
    'I am the Kwisatz Haderach',
    'The worm is the spice. The spice is the worm.',
    'USUL... WE HAVE WORMSIGN',
  ]
  const textIndex = Math.floor(hallucinationLevel * (hallucinationText.length - 1))
  const halluText = hallucinationText[textIndex]

  const pulseCss = hallucinationLevel > 0.5 ? 'hallucination-pulse' : ''

  return (
    <div id="hud">
      {/* Mode indicator */}
      <div className="hud-mode">
        {mode === 'foot' && '⚔ ARRAKIS'}
        {mode === 'worm' && '🐍 RIDING THE MAKER'}
        {mode === 'ornithopter' && '✈ ORNITHOPTER'}
      </div>

      {/* Meters */}
      <div className="hud-meters">
        <div className="meter">
          <span className="meter-label">SPICE</span>
          <div className="meter-bar">
            <div className="meter-fill spice-fill" style={{ width: `${spice * 100}%` }} />
          </div>
        </div>
        <div className="meter">
          <span className="meter-label">WATER</span>
          <div className="meter-bar">
            <div className="meter-fill water-fill" style={{ width: `${water * 100}%` }} />
          </div>
        </div>
        {hallucinationLevel > 0.05 && (
          <div className="meter">
            <span className="meter-label" style={{ color: '#cc44ff' }}>VISION</span>
            <div className="meter-bar">
              <div className="meter-fill vision-fill" style={{ width: `${hallucinationLevel * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Thump indicator */}
      {thumping && (
        <div className="thump-indicator">
          <div className="thump-text">THUMPING</div>
          <div className="thump-bar">
            <div className="thump-fill" style={{ width: `${thumpProgress * 100}%` }} />
          </div>
          {thumpProgress > 0.8 && <div className="thump-warning">WORMSIGN INCOMING</div>}
        </div>
      )}

      {/* Hallucination text */}
      {hallucinationLevel > 0.2 && halluText && (
        <div className={`hallucination-text ${pulseCss}`} style={{
          opacity: hallucinationLevel,
          fontSize: `${14 + hallucinationLevel * 8}px`,
        }}>
          {halluText}
        </div>
      )}

      {/* Mode-specific instructions */}
      <div className="hud-hint">
        {mode === 'foot' && !thumping && 'Hold T to thump · Walk to orange spice · E near ornithopter'}
        {mode === 'foot' && thumping && 'Keep thumping... the worm comes...'}
        {mode === 'worm' && 'A/D to steer · Shift to surge · E to dismount'}
        {mode === 'ornithopter' && 'WASD + Q/E altitude · Shift boost · E near ground to land'}
      </div>

      {/* Controls toggle */}
      <button className="controls-btn" onClick={toggleControls}>
        {showControls ? 'Hide' : 'Controls'}
      </button>

      {showControls && (
        <div className="controls-panel">
          <div className="ctrl-title">CONTROLS</div>
          <div className="ctrl-row"><span>WASD</span><span>Move</span></div>
          <div className="ctrl-row"><span>Mouse</span><span>Look</span></div>
          <div className="ctrl-row"><span>Shift</span><span>Sprint/Boost</span></div>
          <div className="ctrl-row"><span>Space</span><span>Jump/Up</span></div>
          <div className="ctrl-row"><span>Q</span><span>Altitude down</span></div>
          <div className="ctrl-row"><span>T (hold)</span><span>Thump (summon worm)</span></div>
          <div className="ctrl-row"><span>E</span><span>Board/Dismount</span></div>
          <div className="ctrl-row ctrl-note">Walk into orange spice fields to collect spice and hallucinate</div>
          <div className="ctrl-row ctrl-note">Click canvas to capture mouse</div>
        </div>
      )}

      {/* Crosshair */}
      <div className="crosshair" />
    </div>
  )
}
