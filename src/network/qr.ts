import QRCode from 'qrcode';

export function toQrDataUrl(text: string) {
  return QRCode.toDataURL(text, { margin: 1, scale: 6 });
}

