import { ImageResponse } from 'next/og';

/** The share preview used when a page has no photo of its own: the PetApp tag on mist, 1200×630. */
export function GET() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#edf2ef',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          width: 900,
          height: 330,
          background: '#ffffff',
          borderRadius: 64,
          position: 'relative',
          paddingLeft: 150,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 48,
            top: 135,
            width: 60,
            height: 60,
            borderRadius: 60,
            background: '#edf2ef',
            border: '8px solid #b88a1b',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 120, fontWeight: 800, color: '#15201d', letterSpacing: -4 }}>
            PetApp
          </div>
          <div style={{ fontSize: 36, color: '#586663' }}>
            Reels, contests, care and shopping for pets
          </div>
        </div>
      </div>
    </div>,
    { width: 1200, height: 630, headers: { 'Cache-Control': 'public, max-age=86400' } },
  );
}
