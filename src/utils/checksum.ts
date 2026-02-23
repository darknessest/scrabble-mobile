export function computeChecksum(input: string): string {
  let crc = 0xffffffff;

  for (let index = 0; index < input.length; index++) {
    crc ^= input.charCodeAt(index);
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}
