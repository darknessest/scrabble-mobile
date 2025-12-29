import jsQR from 'jsqr';

export class QrScanner {
    private appendLog: (msg: string) => void;

    constructor(appendLog: (msg: string) => void) {
        this.appendLog = appendLog;
    }

    async scanInto(
        target: HTMLTextAreaElement,
        onScanned?: (data: string) => void | Promise<void>
    ): Promise<void> {
        const modal = document.createElement('div');
        modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: #000; display: flex; flex-direction: column; z-index: 2000;
    `;

        const videoContainer = document.createElement('div');
        videoContainer.style.cssText = `position: relative; width: 100%; flex: 1; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #000;`;

        const video = document.createElement('video');
        video.style.cssText = `width: 100%; height: 100%; object-fit: cover;`;
        video.setAttribute('playsinline', 'true');
        videoContainer.appendChild(video);

        const reticle = document.createElement('div');
        reticle.style.cssText = `
      position: absolute; width: 250px; height: 250px;
      border: 2px solid rgba(255, 255, 255, 0.8);
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
      border-radius: 16px;
      pointer-events: none;
    `;
        videoContainer.appendChild(reticle);

        const controls = document.createElement('div');
        controls.style.cssText = `
      width: 100%; background: #000;
      display: flex; justify-content: center; padding: 20px; padding-bottom: max(20px, env(safe-area-inset-bottom));
    `;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Cancel Scan';
        closeBtn.className = 'primary danger';
        closeBtn.style.minWidth = '120px';
        closeBtn.onclick = () => stop();
        controls.appendChild(closeBtn);

        modal.appendChild(videoContainer);
        modal.appendChild(controls);
        document.body.appendChild(modal);

        let stream: MediaStream | null = null;
        let animationFrameId: number | null = null;
        let isActive = true;

        const stop = () => {
            isActive = false;
            if (stream) {
                stream.getTracks().forEach((t) => t.stop());
            }
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            if (document.body.contains(modal)) {
                document.body.removeChild(modal);
            }
        };

        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            if (!isActive) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }

            video.srcObject = stream;
            await video.play();

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            if (!ctx) {
                this.appendLog('Canvas context not supported');
                stop();
                return;
            }

            const tick = () => {
                if (!isActive) return;

                if (video.readyState === video.HAVE_ENOUGH_DATA) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const code = jsQR(imageData.data, imageData.width, imageData.height, {
                        inversionAttempts: "dontInvert",
                    });

                    if (code && code.data) {
                        target.value = code.data;
                        this.appendLog('QR scanned successfully');
                        if (onScanned) {
                            Promise.resolve(onScanned(code.data)).catch((err) =>
                                this.appendLog(`Auto-connect error: ${String(err)}`)
                            );
                        }
                        stop();
                        return;
                    }
                }
                animationFrameId = requestAnimationFrame(tick);
            };

            tick();
        } catch (err) {
            this.appendLog(`Camera error: ${err}`);
            stop();
        }
    }
}
