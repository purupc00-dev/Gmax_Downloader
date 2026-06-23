/**
 * Types and helper functions for parsing M3U8 Master and Media playlists.
 */

export interface MasterPlaylistItem {
  uri: string;
  resolution?: string;
  bandwidth?: number;
  codecs?: string;
  name?: string;
  index: number;
}

export interface MediaSegment {
  index: number;
  duration: number;
  uri: string; // resolved absolute or relative URL
  title?: string;
  keyInfo?: {
    method: string;
    uri: string;
    iv?: Uint8Array;
    resolvedKey?: Uint8Array; // fetched key data
  };
}

export interface AudioTrackItem {
  name: string;
  language?: string;
  uri?: string;
  group?: string;
  isDefault: boolean;
  index: number;
}

export interface ParseResult {
  isMaster: boolean;
  masterItems: MasterPlaylistItem[];
  audioItems: AudioTrackItem[];
  segments: MediaSegment[];
  targetDuration?: number;
  mediaSequence: number;
  isLive: boolean;
}

/**
 * Parses raw m3u8 file text and resolves internal paths relative to parent URL.
 */
export function parseM3U8(text: string, playlistUrl: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const masterItems: MasterPlaylistItem[] = [];
  const audioItems: AudioTrackItem[] = [];
  const segments: MediaSegment[] = [];
  
  let isMaster = false;
  let targetDuration: number | undefined;
  let mediaSequence = 0;
  let isLive = true; // Default to live, set to static block if we see #EXT-X-ENDLIST

  let currentKeyInfo: MediaSegment["keyInfo"] | undefined;
  let currentSegmentDuration = 0;
  let currentSegmentTitle = "";
  let segmentIndexCount = 0;

  // Helper to resolve absolute/relative URLs
  const resolveUrl = (relativeOrAbsolute: string, base: string): string => {
    try {
      return new URL(relativeOrAbsolute, base).href;
    } catch (e) {
      return relativeOrAbsolute;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith("#")) {
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        isMaster = true;
        const meta = line.substring("#EXT-X-STREAM-INF:".length);
        
        // Extract properties from stream metadata
        const bandwidthMatch = meta.match(/BANDWIDTH=(\d+)/i);
        const resolutionMatch = meta.match(/RESOLUTION=([0-9x]+)/i);
        const codecsMatch = meta.match(/CODECS="([^"]+)"/i);
        const nameMatch = meta.match(/NAME="([^"]+)"/i);

        // The next non-empty, non-comment line represents the URI for this stream
        let streamUri = "";
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (nextLine && !nextLine.startsWith("#")) {
            streamUri = resolveUrl(nextLine, playlistUrl);
            break;
          }
        }

        masterItems.push({
          uri: streamUri,
          resolution: resolutionMatch ? resolutionMatch[1] : undefined,
          bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : undefined,
          codecs: codecsMatch ? codecsMatch[1] : undefined,
          name: nameMatch ? nameMatch[1] : undefined,
          index: masterItems.length,
        });
      } else if (line.startsWith("#EXT-X-MEDIA:") && line.includes("TYPE=AUDIO")) {
        const nameMatch = line.match(/NAME="([^"]+)"/i);
        const langMatch = line.match(/LANGUAGE="([^"]+)"/i);
        const uriMatch = line.match(/URI="([^"]+)"/i);
        const groupMatch = line.match(/GROUP-ID="([^"]+)"/i);
        const defaultMatch = line.match(/DEFAULT=(YES|NO)/i);

        audioItems.push({
          name: nameMatch ? nameMatch[1] : "Audio Track " + (audioItems.length + 1),
          language: langMatch ? langMatch[1] : undefined,
          uri: uriMatch ? resolveUrl(uriMatch[1], playlistUrl) : undefined,
          group: groupMatch ? groupMatch[1] : undefined,
          isDefault: defaultMatch ? defaultMatch[1].toUpperCase() === "YES" : false,
          index: audioItems.length,
        });
      } else if (line.startsWith("#EXT-X-TARGETDURATION:")) {
        targetDuration = parseFloat(line.substring("#EXT-X-TARGETDURATION:".length));
      } else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        mediaSequence = parseInt(line.substring("#EXT-X-MEDIA-SEQUENCE:".length), 10);
      } else if (line.startsWith("#EXT-X-ENDLIST")) {
        isLive = false;
      } else if (line.startsWith("#EXTINF:")) {
        const extinfMeta = line.substring("#EXTINF:".length);
        const commaIndex = extinfMeta.indexOf(",");
        const durationStr = commaIndex > -1 ? extinfMeta.substring(0, commaIndex) : extinfMeta;
        currentSegmentDuration = parseFloat(durationStr) || 0;
        currentSegmentTitle = commaIndex > -1 ? extinfMeta.substring(commaIndex + 1).trim() : "";
      } else if (line.startsWith("#EXT-X-KEY:")) {
        const keyMeta = line.substring("#EXT-X-KEY:".length);
        const methodMatch = keyMeta.match(/METHOD=([^,\s]+)/i);
        const uriMatch = keyMeta.match(/URI="([^"]+)"/i);
        const ivMatch = keyMeta.match(/IV=(0[xX][0-9a-fA-F]+|[0-9a-fA-F]+)/i);

        if (methodMatch) {
          const method = methodMatch[1].toUpperCase();
          if (method !== "NONE" && uriMatch) {
            let ivBytes: Uint8Array | undefined;
            if (ivMatch) {
              const ivStr = ivMatch[1].replace(/^0[xX]/, "");
              // Convert hex string to Uint8Array
              ivBytes = new Uint8Array(16);
              for (let k = 0; k < 16; k++) {
                if (k * 2 < ivStr.length) {
                  ivBytes[k] = parseInt(ivStr.substring(k * 2, k * 2 + 2), 16);
                }
              }
            }
            
            currentKeyInfo = {
              method,
              uri: resolveUrl(uriMatch[1], playlistUrl),
              iv: ivBytes,
            };
          } else if (method === "NONE") {
            currentKeyInfo = undefined;
          }
        }
      }
    } else {
      // It's a segment URL line (in media playlist)
      const segmentUrl = resolveUrl(line, playlistUrl);
      const segmentSeq = mediaSequence + segmentIndexCount;

      // If key is AES encrypted and IV is not custom specified, the IV defaults to the 16-byte representation of sequence number
      let keyInfo = currentKeyInfo ? { ...currentKeyInfo } : undefined;
      if (keyInfo && keyInfo.method === "AES-128" && !keyInfo.iv) {
        const defaultIv = new Uint8Array(16);
        // Write the integer segmentSeq to the end of defaultIv as a 32-bit big-endian int
        const view = new DataView(defaultIv.buffer);
        view.setUint32(12, segmentSeq, false); // False indicates Big-Endian representation
        keyInfo.iv = defaultIv;
      }

      segments.push({
        index: segmentIndexCount,
        duration: currentSegmentDuration || 10, //Fallback
        uri: segmentUrl,
        title: currentSegmentTitle,
        keyInfo,
      });

      segmentIndexCount++;
      // reset specific EXTINF segment states (key persists until overridden)
      currentSegmentDuration = 0;
      currentSegmentTitle = "";
    }
  }

  return {
    isMaster,
    masterItems,
    audioItems,
    segments,
    targetDuration,
    mediaSequence,
    isLive,
  };
}
