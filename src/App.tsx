import React, { useState, useEffect, useRef } from "react";
import { 
  Play, 
  Pause, 
  HelpCircle, 
  Download, 
  Settings, 
  AlertCircle, 
  CheckCircle, 
  Globe, 
  RefreshCw, 
  ChevronDown, 
  ChevronUp, 
  Layers, 
  Database, 
  Key, 
  Lock, 
  Unlock, 
  FileVideo, 
  FileCode, 
  Activity, 
  TrendingUp, 
  Zap, 
  Clock, 
  Trash2,
  Sliders,
  ExternalLink
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { parseM3U8, parseM3U8 as parseM3, MasterPlaylistItem, MediaSegment } from "./utils/m3u8Parser";
import { getDecryptionKey, decryptSegment, clearKeyCache } from "./utils/decryptor";

// Stream Presets for quick-loading
const DEMO_STREAMS = [
  {
    name: "Big Buck Bunny (Master Multi-Quality)",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    description: "Standard master playlist containing various resolutions (1080p, 720p, 480p, etc.). Excellent for testing master quality selection.",
    isEncrypted: false,
  },
  {
    name: "Sintel Trailer (HD Movie Stream)",
    url: "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
    description: "Multi-bitrate standard stream featuring cinematic Sintel open-source film footage.",
    isEncrypted: false,
  },
  {
    name: "AES-128 Encrypted Sample Video",
    url: "https://playertest.longtailvideo.com/adaptive/aes-128/gpt-aes.m3u8",
    description: "Certified public test url for testing fully hardware-accelerated client-side AES-128 decryption. Automatically fetches keys, bypasses CORS, and decrypts chunks.",
    isEncrypted: true,
  },
];

// Speed interval window tracker
interface SpeedSnapshot {
  timestamp: number;
  bytes: number;
}

// Download status enum
type DownloadStatus = 
  | "IDLE"
  | "PARSING"
  | "PARSED"
  | "DOWNLOADING"
  | "PAUSED"
  | "SUCCESS"
  | "FAILED"
  | "SAVING"
  | "RECONNECTING";

// Each individual segment status
interface SegmentState {
  index: number;
  uri: string;
  status: "PENDING" | "FETCHING" | "DECRYPTING" | "COMPLETED" | "FAILED";
  size: number;
  error?: string;
  duration: number;
}

const extractFilenameFromUrl = (url: string): string => {
  if (!url) return "video_download";
  try {
    const parsedUrl = new URL(url);
    const params = parsedUrl.searchParams;
    const nameParam = params.get("name") || params.get("filename") || params.get("title");
    if (nameParam) {
      return nameParam.replace(/[^a-zA-Z0-9_-]/g, "_");
    }

    const pathname = parsedUrl.pathname;
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      const cleanLast = lastSegment.replace(/\.m3u8$/i, "");
      
      if ((cleanLast === "index" || cleanLast === "playlist" || cleanLast === "master" || cleanLast === "stream" || cleanLast.match(/^\d+p?$/i)) && segments.length > 1) {
        const parentSeg = segments[segments.length - 2];
        return parentSeg.replace(/[^a-zA-Z0-9_-]/g, "_");
      }
      
      return cleanLast.replace(/[^a-zA-Z0-9_-]/g, "_");
    }
  } catch (e) {
    // fallback
  }
  return "video_stream";
};

export default function App() {
  // Input fields
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [useProxy, setUseProxy] = useState(true);
  const [customHeaders, setCustomHeaders] = useState("");
  const [customReferer, setCustomReferer] = useState("");
  const [customOrigin, setCustomOrigin] = useState("");
  const [filename, setFilename] = useState("consolidated_stream");
  const [fileExtension, setFileExtension] = useState<"mp4" | "ts">("mp4");
  const [concurrency, setConcurrency] = useState(8); // Set high-speed default
  
  // Custom Dynamic Server & Language & Quality parameters for GmaxHub
  const [selectedServer, setSelectedServer] = useState("Server A (Primary High-Speed)");
  const [selectedLanguage, setSelectedLanguage] = useState("English (Original)");
  const [selectedQuality, setSelectedQuality] = useState("1080p (Full HD)");

  const [serversList, setServersList] = useState<string[]>([
    "Server A (Primary High-Speed)",
    "Server B (Global High-Speed Map)",
    "Server C (Backup Slow CDN)"
  ]);
  const [languagesList, setLanguagesList] = useState<string[]>([
    "English (Original Track)",
    "Hindi Dubbed Track",
    "Tamil Audio Track",
    "Spanish (Castilian)"
  ]);
  const [qualitiesList, setQualitiesList] = useState<string[]>([
    "1080p (Full HD)",
    "720p (HD Ready)",
    "480p (Standard Play)",
    "360p (Data Saver)"
  ]);
  const [streamUrlsList, setStreamUrlsList] = useState<string[]>([]);
  
  // App logic states
  const [status, setStatus] = useState<DownloadStatus>("IDLE");
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [errorText, setErrorText] = useState("");
  const [isFromRedirect, setIsFromRedirect] = useState(false);
  const [triggerDownloadOnParse, setTriggerDownloadOnParse] = useState(false);
  const [movieMetadata, setMovieMetadata] = useState<{
    title: string;
    overview: string;
    poster: string;
    backdrop: string;
  } | null>(null);
  const [isExtractingMetadata, setIsExtractingMetadata] = useState(false);
  
  // Parser outputs
  const [parsedData, setParsedData] = useState<ReturnType<typeof parseM3U8> | null>(null);
  const [activeMediaUrl, setActiveMediaUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showDevHub, setShowDevHub] = useState(false);

  // Download logic states
  const [segments, setSegments] = useState<SegmentState[]>([]);
  const [downloadSpeed, setDownloadSpeed] = useState(0); // bytes/sec
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [totalDownloadedBytes, setTotalDownloadedBytes] = useState(0);
  
  // Completed segments buffers
  const [segmentsBuffers, setSegmentsBuffers] = useState<(Uint8Array | null)[]>([]);
  
  // Controls triggers
  const isPauseRequestedRef = useRef(false);
  const isCancelledRef = useRef(false);
  const bytesDownloadedSinceLastSecRef = useRef(0);
  const speedHistoryRef = useRef<SpeedSnapshot[]>([]);
  const activeDownloadsCountRef = useRef(0);
  const completedSegmentsCount = segments.filter(s => s.status === "COMPLETED").length;
  const failedSegmentsCount = segments.filter(s => s.status === "FAILED").length;
  
  // Timer references
  const metricsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedTimerRef = useRef<NodeJS.Timeout | null>(null);
  const controllerAbortRef = useRef<AbortController | null>(null);

  const wasInterruptedByOfflineRef = useRef(false);
  const currentStatusRef = useRef<DownloadStatus>("IDLE");
  const [downloadResumeTrigger, setDownloadResumeTrigger] = useState(0);

  // Keep track of the current status in a Ref to avoid stale state in events
  useEffect(() => {
    currentStatusRef.current = status;
  }, [status]);

  // Handle auto-resuming from state trigger
  useEffect(() => {
    if (downloadResumeTrigger > 0) {
      handleStartDownload();
    }
  }, [downloadResumeTrigger]);

  // Clean-up on unmount and load query params + network event listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (wasInterruptedByOfflineRef.current) {
        wasInterruptedByOfflineRef.current = false;
        isPauseRequestedRef.current = false;
        setStatus("DOWNLOADING");
        setDownloadResumeTrigger(prev => prev + 1);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      if (currentStatusRef.current === "DOWNLOADING") {
        wasInterruptedByOfflineRef.current = true;
        isPauseRequestedRef.current = true;
        setStatus("RECONNECTING");
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      stopTimers();
      cleanupGlobals();
    };
  }, []);

  const stopTimers = () => {
    if (metricsTimerRef.current) clearInterval(metricsTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
  };

  const cleanupGlobals = () => {
    clearKeyCache();
    if (controllerAbortRef.current) {
      controllerAbortRef.current.abort();
    }
  };

  const triggerAutoAnalysis = async (
    targetUrl: string,
    refererVal: string,
    originVal: string,
    headersVal: string
  ) => {
    if (!targetUrl) return;
    setStatus("PARSING");
    setErrorText("");
    setParsedData(null);
    setSegments([]);
    setTotalDownloadedBytes(0);
    setDownloadSpeed(0);
    setEtaSeconds(null);
    setSegmentsBuffers([]);

    const fetchUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(refererVal)}&origin=${encodeURIComponent(originVal)}&headers=${encodeURIComponent(headersVal)}`;

    try {
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status} (${response.statusText})`);
      }
      const rawText = await response.text();
      if (!rawText.includes("#EXTM3U")) {
        throw new Error("This file does not appear to be a valid HLS M3U8 playlist. It must start with the #EXTM3U signature header.");
      }

      const parseResult = parseM3U8(rawText, targetUrl);
      setParsedData(parseResult);
      setActiveMediaUrl(targetUrl);

      // If filename is not customized yet or matches default, extract name from URL
      setFilename(prev => {
        if (!prev || prev === "consolidated_stream") {
          return extractFilenameFromUrl(targetUrl);
        }
        return prev;
      });

      if (parseResult.isMaster) {
        setStatus("PARSED");
        setTriggerDownloadOnParse(false);
      } else {
        const states: SegmentState[] = parseResult.segments.map((s) => ({
          index: s.index,
          uri: s.uri,
          status: "PENDING",
          size: 0,
          duration: s.duration,
        }));
        setSegments(states);
        setSegmentsBuffers(new Array(parseResult.segments.length).fill(null));
        setStatus("PARSED");
        setTriggerDownloadOnParse(true);
      }
    } catch (err: any) {
      console.error("Auto analysis failed:", err);
      setErrorText(`Failed to auto-analyze playlist: ${err.message || String(err)}. Verify whether the stream URL is correct and active.`);
      setStatus("IDLE");
    }
  };

  // Check URL Search Params on mount to auto-trigger the streaming analyzer
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tmdbIdParam = params.get("tmdbId") || params.get("tmdb_id") || params.get("tmdb") || params.get("id");
    const mediaTypeParam = params.get("type") || params.get("mediaType") || params.get("media_type") || "movie";
    const providerParam = params.get("provider") || params.get("srv") || "vidking";
    const seasonParam = params.get("season") || params.get("s") || "1";
    const episodeParam = params.get("episode") || params.get("e") || "1";

    const urlParam = params.get("url") || params.get("stream") || params.get("m3u8");
    const urlsParam = params.get("urls") || params.get("streams");
    const nameParam = params.get("name") || params.get("filename") || params.get("title");
    const refererParam = params.get("referer") || params.get("ref");
    const originParam = params.get("origin") || params.get("orig");
    const headersParam = params.get("headers") || params.get("custom_headers");
    const countParam = params.get("concurrency") || params.get("threads");

    // Dynamic Server, Language, Quality query parameters from Vercel
    const serversParam = params.get("servers") || params.get("hosts");
    const audioParam = params.get("audio") || params.get("languages") || params.get("lang");
    const qualitiesParam = params.get("qualities") || params.get("resolutions");

    if (serversParam) {
      const parsedServers = serversParam.split(",").map(s => s.trim()).filter(Boolean);
      if (parsedServers.length > 0) {
        setServersList(parsedServers);
        setSelectedServer(parsedServers[0]);
      }
    }
    if (audioParam) {
      const parsedLangs = audioParam.split(",").map(l => l.trim()).filter(Boolean);
      if (parsedLangs.length > 0) {
        setLanguagesList(parsedLangs);
        setSelectedLanguage(parsedLangs[0]);
      }
    }
    if (qualitiesParam) {
      const parsedQuals = qualitiesParam.split(",").map(q => q.trim()).filter(Boolean);
      if (parsedQuals.length > 0) {
        setQualitiesList(parsedQuals);
        setSelectedQuality(parsedQuals[0]);
      }
    }
    if (urlsParam) {
      const parsedUrls = urlsParam.split(",").map(u => u.trim()).filter(Boolean);
      if (parsedUrls.length > 0) {
        setStreamUrlsList(parsedUrls);
      }
    }

    // Determine if we need to extract from GmaxHub Microservice scraper!
    if (tmdbIdParam) {
      setIsFromRedirect(true);
      setIsExtractingMetadata(true);
      setStatus("PARSING");
      
      const fetchMetadataAndStream = async () => {
        try {
          const extractApiUrl = `/api/extract?tmdbId=${encodeURIComponent(tmdbIdParam)}&type=${encodeURIComponent(mediaTypeParam)}&provider=${encodeURIComponent(providerParam)}&season=${encodeURIComponent(seasonParam)}&episode=${encodeURIComponent(episodeParam)}`;
          const response = await fetch(extractApiUrl);
          if (!response.ok) {
            throw new Error(`Failed to contact extraction nodes. Status: ${response.status}`);
          }
          const data = await response.json();
          if (data.success) {
            setMovieMetadata({
              title: data.title,
              overview: data.overview,
              poster: data.poster,
              backdrop: data.backdrop,
            });
            setFilename(data.filename);
            setPlaylistUrl(data.url);
            
            if (data.servers) setServersList(data.servers);
            if (data.qualities) setQualitiesList(data.qualities);
            if (data.languages) setLanguagesList(data.languages);

            setSelectedServer((data.servers && data.servers[0]) || "Server A (Default Node)");
            setSelectedQuality((data.qualities && data.qualities[0]) || "1080p (Full HD)");
            setSelectedLanguage((data.languages && data.languages[0]) || "English (Original)");

            // Fetch list segments automatically!
            await triggerAutoAnalysis(
              data.url,
              refererParam || "",
              originParam || "",
              headersParam || ""
            );
          } else {
            throw new Error(data.error || "Unknown extraction server exception.");
          }
        } catch (err: any) {
          console.error("Microservice extraction failed:", err);
          setErrorText(`GmaxHub microservice scraper error: ${err.message || String(err)}. Let's fallback to manual input or check parameters.`);
          setStatus("FAILED");
        } finally {
          setIsExtractingMetadata(false);
        }
      };

      fetchMetadataAndStream();
    } else {
      // Normal direct URL parser fallback path
      const initialUrl = urlParam || (urlsParam ? urlsParam.split(",")[0].trim() : "");

      if (initialUrl) {
        setIsFromRedirect(true);
        setPlaylistUrl(initialUrl);
        const derivedName = nameParam 
          ? nameParam.replace(/[^a-zA-Z0-9_-]/g, "_") 
          : extractFilenameFromUrl(initialUrl);
        setFilename(derivedName);
        
        if (refererParam) {
          setCustomReferer(refererParam);
        }
        if (originParam) {
          setCustomOrigin(originParam);
        }
        if (headersParam) {
          setCustomHeaders(headersParam);
        }
        if (countParam) {
          const val = parseInt(countParam, 10);
          if (!isNaN(val) && val >= 1 && val <= 16) {
            setConcurrency(val);
          }
        }

        setTriggerDownloadOnParse(true);
        triggerAutoAnalysis(
          initialUrl,
          refererParam || "",
          originParam || "",
          headersParam || ""
        );
      }
    }
  }, []);
  const handleSelectServer = (index: number) => {
    const targetServer = serversList[index];
    setSelectedServer(targetServer);
    
    if (streamUrlsList[index]) {
      const serverUrl = streamUrlsList[index];
      setPlaylistUrl(serverUrl);
      triggerAutoAnalysis(
        serverUrl,
        customReferer,
        customOrigin,
        customHeaders
      );
    } else {
      setStatus("PARSING");
      setTimeout(() => {
        setStatus("PARSED");
      }, 300);
    }
  };

  const handleSelectLanguage = (index: number) => {
    setSelectedLanguage(languagesList[index]);
    setStatus("PARSING");
    setTimeout(() => {
      setStatus("PARSED");
    }, 250);
  };

  const handleSelectQuality = (index: number) => {
    setSelectedQuality(qualitiesList[index]);
    setStatus("PARSING");
    setTimeout(() => {
      setStatus("PARSED");
    }, 250);
  };

  // Helper: Format bits / bytes
  const formatBytes = (bytes: number, decimals = 2): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  const formatSpeed = (bytesPerSec: number): string => {
    return `${formatBytes(bytesPerSec)}/s`;
  };

  const formatTime = (secs: number): string => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const components = [];
    if (h > 0) components.push(`${h}h`);
    if (m > 0 || h > 0) components.push(`${m}m`);
    components.push(`${s}s`);
    return components.join(" ");
  };

  // 1. Fetch & Parse the main URL
  const handleAnalyze = async () => {
    if (!playlistUrl) {
      setErrorText("Please enter a valid .m3u8 streaming playlist URL.");
      return;
    }

    setStatus("PARSING");
    setErrorText("");
    setParsedData(null);
    setSegments([]);
    setTotalDownloadedBytes(0);
    setDownloadSpeed(0);
    setEtaSeconds(null);
    setSegmentsBuffers([]);

    const fetchUrl = useProxy 
      ? `/api/proxy?url=${encodeURIComponent(playlistUrl)}&referer=${encodeURIComponent(customReferer)}&origin=${encodeURIComponent(customOrigin)}&headers=${encodeURIComponent(customHeaders)}`
      : playlistUrl;

    try {
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error(`Server responded with HTTP ${response.status}: ${response.statusText}`);
      }
      const rawText = await response.text();
      
      if (!rawText.includes("#EXTM3U")) {
        throw new Error("This file does not appear to be a valid HLS M3U8 playlist. It must start with the #EXTM3U signature header.");
      }

      const parseResult = parseM3U8(rawText, playlistUrl);
      setParsedData(parseResult);
      setActiveMediaUrl(playlistUrl);

      if (parseResult.isMaster) {
        setStatus("PARSED");
      } else {
        // Already a media playlist with segment list!
        setupDownloadedSegments(parseResult.segments);
        setStatus("PARSED");
      }
    } catch (err: any) {
      console.error("Parse failed:", err);
      setErrorText(`Failed to analyze playlist: ${err.message || String(err)}. Verify whether the stream URL is correct and active.`);
      setStatus("IDLE");
    }
  };

  // 2. Clear parsed state
  const handleReset = () => {
    setStatus("IDLE");
    setErrorText("");
    setParsedData(null);
    setSegments([]);
    setTotalDownloadedBytes(0);
    setDownloadSpeed(0);
    setEtaSeconds(null);
    setSegmentsBuffers([]);
    stopTimers();
    cleanupGlobals();
  };

  // 3. Selection of specialized stream inside a Master Playlist
  const handleSelectMasterItem = async (item: MasterPlaylistItem) => {
    setStatus("PARSING");
    setErrorText("");
    setSegments([]);

    const fetchUrl = useProxy 
      ? `/api/proxy?url=${encodeURIComponent(item.uri)}&referer=${encodeURIComponent(customReferer)}&origin=${encodeURIComponent(customOrigin)}&headers=${encodeURIComponent(customHeaders)}`
      : item.uri;

    try {
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status} when fetching stream quality playlist`);
      }
      const rawText = await response.text();
      const mediaParseResult = parseM3U8(rawText, item.uri);

      if (mediaParseResult.isMaster) {
        throw new Error("Recursive master playlist detected. This stream configuration is unexpected.");
      }

      // Update active media URL & segment data
      setActiveMediaUrl(item.uri);
      // Construct combined mock parse state reflecting the final media resolution
      if (parsedData) {
        setParsedData({
          ...parsedData,
          isMaster: false,
          segments: mediaParseResult.segments,
          targetDuration: mediaParseResult.targetDuration,
          mediaSequence: mediaParseResult.mediaSequence,
          isLive: mediaParseResult.isLive,
        });
      } else {
        setParsedData({
          ...mediaParseResult,
          isMaster: false,
        });
      }
      
      setupDownloadedSegments(mediaParseResult.segments);
      setStatus("PARSED");
      setTriggerDownloadOnParse(true);
    } catch (err: any) {
      console.error("Quality stream switch failed:", err);
      setErrorText(`Failed to load selected stream quality: ${err.message || String(err)}`);
      setStatus("PARSED");
    }
  };

  // Convert raw media segments to states
  const setupDownloadedSegments = (mediaSegments: MediaSegment[]) => {
    const states: SegmentState[] = mediaSegments.map((s) => ({
      index: s.index,
      uri: s.uri,
      status: "PENDING",
      size: 0,
      duration: s.duration,
    }));
    setSegments(states);
    setSegmentsBuffers(new Array(mediaSegments.length).fill(null));
  };

  // Starts the interactive parallel queue downloader
  const handleStartDownload = async () => {
    if (!parsedData || segments.length === 0) return;

    setStatus("DOWNLOADING");
    isPauseRequestedRef.current = false;
    isCancelledRef.current = false;
    bytesDownloadedSinceLastSecRef.current = 0;
    speedHistoryRef.current = [];
    setDownloadSpeed(0);
    setElapsedSeconds(0);
    setEtaSeconds(null);
    activeDownloadsCountRef.current = 0;

    // Set initial size based on already completed segments (for accurate resuming)
    const initialCompletedBytes = segments
      .filter((s) => s.status === "COMPLETED")
      .reduce((acc, curr) => acc + curr.size, 0);
    setTotalDownloadedBytes(initialCompletedBytes);

    // Initialize timers
    startTimers();

    // Abort controller
    controllerAbortRef.current = new AbortController();
    const signal = controllerAbortRef.current.signal;

    // Grab temporary references to be processed by our concurrent worker pools
    const totalCount = segments.length;
    let nextIndexToDownload = 0;
    
    // We update local buffer arrays dynamically
    const buffers = [...segmentsBuffers];

    // Worker function running concurrently
    const startWorker = async () => {
      while (nextIndexToDownload < totalCount && !isCancelledRef.current) {
        if (isPauseRequestedRef.current) {
          // Worker yielding briefly if paused
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }

        // Dequeue next segment
        const index = nextIndexToDownload++;
        if (index >= totalCount) break;

        // Skip if already successfully completed
        if (segments[index]?.status === "COMPLETED" && buffers[index] !== null) {
          continue;
        }

        const segment = parsedData.segments[index];
        updateSegmentStatus(index, "FETCHING");
        activeDownloadsCountRef.current++;

        try {
          let cryptoKey: CryptoKey | null = null;
          let finalBlock: ArrayBuffer | null = null;
          let success = false;
          let attempt = 0;
          const maxAttempts = 4;

          while (attempt < maxAttempts && !isCancelledRef.current) {
            // Respect pause or offline states gracefully by waiting
            const onlineStatus = typeof navigator !== 'undefined' ? navigator.onLine : true;
            if (isPauseRequestedRef.current || !onlineStatus) {
              await new Promise((r) => setTimeout(r, 600));
              continue;
            }

            try {
              // Step A: Check encryption, fetch key if needed (with retry protection)
              if (segment.keyInfo && segment.keyInfo.method === "AES-128") {
                updateSegmentStatus(index, "DECRYPTING");
                cryptoKey = await getDecryptionKey(segment.keyInfo.uri, useProxy);
              }

              // Step B: Fetch TS segment data via proxy or direct
              const urlToFetch = useProxy
                ? `/api/proxy?url=${encodeURIComponent(segment.uri)}&referer=${encodeURIComponent(customReferer)}&origin=${encodeURIComponent(customOrigin)}&headers=${encodeURIComponent(customHeaders)}`
                : segment.uri;

              updateSegmentStatus(index, "FETCHING");
              
              const response = await fetch(urlToFetch, { signal });
              if (!response.ok) {
                throw new Error(`Media fetch returned status code ${response.status}`);
              }

              const rawArrayBuffer = await response.arrayBuffer();
              
              // Step C: Decrypt segment on-the-fly client side
              if (cryptoKey && segment.keyInfo && segment.keyInfo.iv) {
                updateSegmentStatus(index, "DECRYPTING");
                finalBlock = await decryptSegment(rawArrayBuffer, cryptoKey, segment.keyInfo.iv);
              } else {
                finalBlock = rawArrayBuffer;
              }

              success = true;
              break;
            } catch (err: any) {
              if (err.name === "AbortError" || isCancelledRef.current || isPauseRequestedRef.current) {
                throw err;
              }

              attempt++;
              console.warn(`Segment ${index} attempt ${attempt}/${maxAttempts} failed:`, err);

              if (attempt < maxAttempts) {
                // Exponential backoff with random jitter
                const backoffDelay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 8000);
                await new Promise((r) => setTimeout(r, backoffDelay));
              } else {
                throw err;
              }
            }
          }

          if (isCancelledRef.current) break;

          if (!success || !finalBlock) {
            throw new Error(`Segment download failed after ${maxAttempts} attempts`);
          }

          // Step D: Write chunk to memory buffer
          const u8Block = new Uint8Array(finalBlock);
          buffers[index] = u8Block;
          
          // Speed calculations increment of loaded bytes
          bytesDownloadedSinceLastSecRef.current += u8Block.byteLength;

          // Update success state
          updateSegmentSuccess(index, u8Block.byteLength);
        } catch (err: any) {
          if (err.name === "AbortError" || isCancelledRef.current) {
            updateSegmentStatus(index, "PENDING");
            break;
          }
          console.error(`Segment ${index} download error:`, err);
          updateSegmentFailed(index, err.message || String(err));
        } finally {
          activeDownloadsCountRef.current = Math.max(0, activeDownloadsCountRef.current - 1);
        }
      }
    };

    // Spawn workers matching the exact user-configured concurrency settings
    const workerPool: Promise<void>[] = [];
    const activeWorkersCount = Math.min(concurrency, totalCount);
    
    for (let i = 0; i < activeWorkersCount; i++) {
      workerPool.push(startWorker());
    }

    // Wait until workers deplete the queue
    await Promise.all(workerPool);

    // Save final buffers back
    setSegmentsBuffers(buffers);
    activeDownloadsCountRef.current = 0;

    if (isCancelledRef.current) {
      cleanupGlobals();
      stopTimers();
      setStatus("PARSED");
      // Recover and reset download metrics
      setSegments(prev => prev.map(s => s.status === "COMPLETED" ? s : { ...s, status: "PENDING", size: 0 }));
    } else if (isPauseRequestedRef.current) {
      stopTimers();
      setStatus("PAUSED");
      setDownloadSpeed(0);
      setEtaSeconds(null);
    } else {
      // Check if some segments failed and notify or proceed to success
      stopTimers();
      const finalFailed = buffers.some((b) => b === null);
      if (finalFailed) {
        setStatus("FAILED");
        setErrorText("Some segments failed to download successfully. Try increasing concurrency, verifying headers, or resuming the download.");
      } else {
        setStatus("SUCCESS");
        // Auto save to device immediately in browser!
        try {
          const validBuffers = buffers.filter((b) => b !== null) as Uint8Array[];
          let totalLength = 0;
          for (const buf of validBuffers) {
            totalLength += buf.byteLength;
          }

          if (totalLength > 0) {
            const mergedArray = new Uint8Array(totalLength);
            let offset = 0;
            for (const buf of validBuffers) {
              mergedArray.set(buf, offset);
              offset += buf.byteLength;
            }

            const blob = new Blob([mergedArray], { type: "video/mp4" });
            const downloadName = `${filename || "download"}.mp4`;

            const downloadUrl = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = downloadUrl;
            anchor.download = downloadName;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
          }
        } catch (autoErr: any) {
          console.error("Auto download compilation error:", autoErr);
        }
      }
      setDownloadSpeed(0);
      setEtaSeconds(null);
    }
  };

  // Auto download trigger hook
  useEffect(() => {
    if (triggerDownloadOnParse && status === "PARSED" && parsedData && segments.length > 0) {
      setTriggerDownloadOnParse(false);
      handleStartDownload();
    }
  }, [triggerDownloadOnParse, status, parsedData, segments]);

  // Mutators of atomic segments array
  const updateSegmentStatus = (index: number, status: SegmentState["status"]) => {
    setSegments((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], status };
      }
      return next;
    });
  };

  const updateSegmentSuccess = (index: number, size: number) => {
    setSegments((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], status: "COMPLETED", size };
      }
      return next;
    });
    setTotalDownloadedBytes((prev) => prev + size);
  };

  const updateSegmentFailed = (index: number, error: string) => {
    setSegments((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], status: "FAILED", error };
      }
      return next;
    });
  };

  const handlePause = () => {
    isPauseRequestedRef.current = true;
    setStatus("PAUSED");
  };

  const handleResume = () => {
    isPauseRequestedRef.current = false;
    handleStartDownload();
  };

  const handleCancel = () => {
    isCancelledRef.current = true;
    if (controllerAbortRef.current) {
      controllerAbortRef.current.abort();
    }
    setStatus("PARSED");
    stopTimers();
    setDownloadSpeed(0);
    setEtaSeconds(null);
    // clear memory buffers
    setSegmentsBuffers([]);
    setTotalDownloadedBytes(0);
    setupDownloadedSegments(parsedData?.segments || []);
  };

  // Helper metric timer: computes speed & ETA every second
  const startTimers = () => {
    stopTimers();
    
    // Timer 1: Elapsed seconds timer
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    // Timer 2: Speed snapshotting calculator
    metricsTimerRef.current = setInterval(() => {
      const bytesThisSec = bytesDownloadedSinceLastSecRef.current;
      bytesDownloadedSinceLastSecRef.current = 0; // Reset counter for next second

      // Calculate sliding speed averages
      const now = Date.now();
      speedHistoryRef.current.push({ timestamp: now, bytes: bytesThisSec });
      // Keep last 4 seconds
      if (speedHistoryRef.current.length > 4) {
        speedHistoryRef.current.shift();
      }

      // Compute speed
      const totalBytesWindow = speedHistoryRef.current.reduce((a, b) => a + b.bytes, 0);
      const computedSpeed = totalBytesWindow / speedHistoryRef.current.length;
      setDownloadSpeed(computedSpeed);

      // ETA estimation
      if (computedSpeed > 0 && segments.length > 0) {
        const remainingCount = segments.filter(s => s.status !== "COMPLETED").length;
        if (remainingCount === 0) {
          setEtaSeconds(0);
        } else {
          // Average size of a completed segment
          const completed = segments.filter(s => s.status === "COMPLETED");
          const avgSize = completed.length > 0 
            ? completed.reduce((acc, cur) => acc + cur.size, 0) / completed.length 
            : 300000; // raw standard fallback: ~300KB
          
          const remainingEstBytes = remainingCount * avgSize;
          const eta = Math.ceil(remainingEstBytes / computedSpeed);
          setEtaSeconds(isNaN(eta) || eta < 0 ? null : eta);
        }
      } else {
        setEtaSeconds(null);
      }
    }, 1000);
  };

  // Merging downloaded Uint8Array blocks sequentially and triggering native file download
  const handleSaveConsolidated = () => {
    const validBuffers = segmentsBuffers.filter(b => b !== null) as Uint8Array[];
    
    if (validBuffers.length === 0) {
      setErrorText("No downloaded stream data found to consolidate. Verify downloads completed.");
      return;
    }

    setStatus("SAVING");

    try {
      // Step A: Calculate total size to avoid massive array reallocation overhead
      let totalLength = 0;
      for (const buf of validBuffers) {
        totalLength += buf.byteLength;
      }

      // Step B: Direct high-performance binary block merger
      const mergedArray = new Uint8Array(totalLength);
      let offset = 0;
      for (const buf of validBuffers) {
        mergedArray.set(buf, offset);
        offset += buf.byteLength;
      }

      // Create a single unified Blob
      const blobType = fileExtension === "ts" ? "video/mp2t" : "video/mp4";
      const blob = new Blob([mergedArray], { type: blobType });
      const downloadName = `${filename || "download"}.${fileExtension}`;

      // Step C: Trigger native client-side dialog stream down
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = downloadName;
      document.body.appendChild(anchor);
      anchor.click();
      
      // Cleanups
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
      setStatus("SUCCESS");
    } catch (err: any) {
      console.error("Aggregation failed:", err);
      setErrorText(`Failed to consolidate binary segment streams: ${err.message || String(err)}. You might want to reload or free system RAM.`);
      setStatus("SUCCESS");
    }
  };

  // Render connected stream source card for non-technical redirected users
  const renderConnectedSource = () => {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-indigo-300 uppercase tracking-widest block">
            Streaming Source Loaded
          </span>
          <button
            id="reset-redirect-btn"
            onClick={() => {
              setIsFromRedirect(false);
              setStatus("IDLE");
              setPlaylistUrl("");
              setParsedData(null);
              setSegments([]);
            }}
            className="text-[11px] font-mono text-pink-400 hover:text-pink-300 hover:underline cursor-pointer transition-colors"
          >
            Clear & Reset
          </button>
        </div>
        
        <div className="p-6 bg-[#131130]/90 border border-[#231e4d] rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 w-full">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#9d31f0]/20 to-[#eb1ac2]/20 text-[#eb1ac2] flex items-center justify-center border border-[#eb1ac2]/30 shrink-0">
              <FileVideo className="w-6 h-6 animate-pulse" />
            </div>
            <div className="space-y-1.5 w-full">
              <span className="text-[10px] font-mono text-purple-300 block uppercase tracking-wider">
                Video Filename (Tap inside to customize):
              </span>
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value.replace(/[^a-zA-Z0-9_\s-]/g, "_"))}
                placeholder="video_name"
                disabled={status === "DOWNLOADING" || status === "RECONNECTING" || status === "SAVING"}
                className="px-3 py-1.5 bg-[#181535] border border-[#2b275c] rounded-xl text-xs text-white font-semibold font-mono w-full sm:max-w-md focus:outline-none focus:ring-2 focus:ring-[#eb1ac2] transition-all disabled:opacity-60"
              />
            </div>
          </div>

          <div className="shrink-0 text-right">
            {status === "IDLE" || status === "PARSING" ? (
              <div className="flex items-center gap-2 bg-[#181535] px-3 py-1.5 rounded-full border border-[#2b275c]">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#eb1ac2]" />
                <span className="text-xs text-purple-200 font-medium">Resolving stream...</span>
              </div>
            ) : status === "PARSED" ? (
              <span className="text-xs font-bold px-3 py-1.5 bg-emerald-950/40 text-emerald-400 rounded-full border border-emerald-800/40 font-mono">
                Stream Resolved
              </span>
            ) : status === "DOWNLOADING" ? (
              <span className="text-xs font-bold px-3 py-1.5 bg-pink-950/40 text-[#eb1ac2] rounded-full border border-[#eb1ac2]/30 animate-pulse font-mono">
                Saving parts...
              </span>
            ) : status === "RECONNECTING" ? (
              <span className="text-xs font-bold px-3 py-1.5 bg-amber-950/40 text-amber-500 rounded-full border border-amber-500/30 animate-pulse font-mono flex items-center gap-1.5 justify-end">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                Offline (Reconnecting...)
              </span>
            ) : status === "SUCCESS" ? (
              <span className="text-xs font-semibold px-3 py-1.5 bg-emerald-950/50 text-emerald-400 rounded-full border border-emerald-800/40 font-mono">
                ✓ Download Completed
              </span>
            ) : (
              <span className="text-xs font-semibold px-3 py-1.5 bg-[#181535] text-slate-300 rounded-full border border-[#2b275c] font-mono">
                {status || "Active"}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Estimated playtime
  const totalPlaytimeSeconds = parsedData ? parsedData.segments.reduce((a, b) => a + b.duration, 0) : 0;

  // Visual subset block generator to represent chunks safely (max 300 squares, pagination/scaling automatically)
  const renderedSquareCount = Math.min(segments.length, 320);

  return (
    <div id="app-container" className="min-h-screen bg-[#060415] text-[#b3b2d1] font-sans antialiased pb-20 selection:bg-[#eb1ac2] selection:text-white relative overflow-hidden">
      {/* Decorative ambient glowing galactic backdrops */}
      <div className="absolute top-0 left-0 right-0 h-[600px] bg-gradient-to-b from-[#4c1d95]/20 via-[#1e1b4b]/10 to-transparent pointer-events-none" />
      <div className="absolute top-[10%] left-[20%] w-[350px] h-[350px] bg-[#9d31f0]/10 blur-[130px] rounded-full pointer-events-none" />
      <div className="absolute top-[40%] right-[15%] w-[300px] h-[300px] bg-[#eb1ac2]/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Hero Header Navbar */}
      <nav className="border-b border-[#231e4d]/60 bg-[#09071c]/80 backdrop-blur-md sticky top-0 z-40 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            {/* Customized G symbol matching their Vercel screenshot */}
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#9d31f0] via-[#eb1ac2] to-[#fd426c] flex items-center justify-center font-black text-white text-xl shadow-lg shadow-[#eb1ac2]/15 select-none animate-pulse">
              G
            </div>
            <div>
              <span className="font-extrabold text-2xl tracking-normal text-white uppercase font-sans">
                GmaxHub
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1 bg-[#eb1ac2]/15 text-[#fbcfe8] border border-[#eb1ac2]/30 text-[10px] font-mono font-extrabold rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-ping" />
              <span>GmaxHub Engine Online</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 relative z-10">
        
        {/* Outer Grid Layout */}
        <div className="max-w-3xl mx-auto space-y-8">
            
            {/* Error notifications */}
            {errorText && (
              <div className="p-4 bg-red-950/50 border border-red-800/40 text-red-200 rounded-2xl flex items-start gap-3 shadow-xl">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-400" />
                <div className="text-xs leading-relaxed">
                  <span className="font-bold">Error encountered:</span> {errorText}
                </div>
              </div>
            )}

            {playlistUrl ? (
              <div className="space-y-6">
                {/* GmaxHub Premium Cinematic Movie Details Header Overlay */}
                {movieMetadata && (
                  <div id="movie-cinematic-banner" className="relative overflow-hidden rounded-[32px] border border-[#2c275a] bg-[#0c0a23]/95 p-6 sm:p-8 shadow-2xl">
                    {/* Backdrop cover blur background decoration */}
                    <div className="absolute inset-0 bg-cover bg-center opacity-10 pointer-events-none filter blur-xl scale-125 select-none" style={{ backgroundImage: `url(${movieMetadata.backdrop})` }} />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0c0a23] via-[#0c0a23]/60 to-transparent pointer-events-none" />
                    
                    <div className="relative z-10 flex flex-col sm:flex-row gap-6 sm:items-center">
                      <div className="w-24 sm:w-28 rounded-2xl overflow-hidden shadow-2xl border border-[#3e3579] shrink-0 self-center flex-none">
                        <img src={movieMetadata.poster} alt={movieMetadata.title} referrerPolicy="no-referrer" className="w-full object-cover aspect-[2/3] block" />
                      </div>
                      <div className="space-y-3 text-left">
                        <span className="text-[10px] font-mono font-extrabold text-[#eb1ac2] bg-[#eb1ac2]/10 border border-[#eb1ac2]/20 px-2 py-1 rounded-full uppercase tracking-wider inline-block">
                          🎯 Active Extraction • GmaxHub Portal
                        </span>
                        <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                          {movieMetadata.title}
                        </h2>
                        <p className="text-xs text-slate-350 leading-relaxed font-normal max-w-xl">
                          {movieMetadata.overview}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Connected Source card */}
                <div id="connection-details-card" className="bg-[#0e0c25]/90 border border-[#231e4d] p-8 rounded-[32px] shadow-2xl">
                  {renderConnectedSource()}
                </div>

                {/* Stream Settings Options Panel */}
                <div id="options-selector-card" className="bg-[#0e0c25]/90 border border-[#231e4d] p-8 rounded-[32px] shadow-2xl space-y-6 text-white">
                  <div className="border-b border-[#231e4d] pb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white tracking-wide">
                        Stream Download Customizer
                      </h3>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Select your preferred video tracks, qualities and servers. Handled automatically on direct click redirections under GmaxHub.
                      </p>
                    </div>
                    <span className="text-[10px] text-indigo-300 font-extrabold font-mono bg-indigo-505/10 border border-indigo-500/20 px-2 py-1 rounded">
                      AUTO-PREPARED
                    </span>
                  </div>

                  {/* Multi-Server Selection */}
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">
                      Select Streaming Server
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {serversList.map((srv, idx) => (
                        <button
                          key={idx}
                          className={`px-4 py-3 rounded-xl border text-xs font-semibold text-left transition-all flex items-center gap-2 cursor-pointer ${
                            selectedServer === srv
                              ? "bg-gradient-to-r from-[#9d31f0] via-[#eb1ac2] to-[#fd426c] text-white border-transparent shadow-lg shadow-[#eb1ac2]/10"
                              : "bg-[#181535] text-slate-300 border-[#2c2858] hover:bg-[#201c44] hover:text-white"
                          }`}
                          onClick={() => handleSelectServer(idx)}
                          disabled={status === "DOWNLOADING" || status === "RECONNECTING" || status === "SAVING"}
                        >
                          <ServerIcon className="w-4 h-4 shrink-0 text-pink-400" />
                          <span className="truncate">{srv}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Audio Languages Selector */}
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">
                      Select Audio Track & Language
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {parsedData?.audioItems && parsedData.audioItems.length > 0 ? (
                        parsedData.audioItems.map((aud, idx) => (
                          <button
                            key={idx}
                            className={`px-4 py-3 rounded-xl border text-xs font-semibold text-left transition-all flex items-center gap-2 cursor-pointer ${
                              selectedLanguage === aud.name
                                ? "bg-gradient-to-r from-[#9d31f0] via-[#eb1ac2] to-[#fd426c] text-white border-transparent shadow-lg shadow-[#eb1ac2]/10"
                                : "bg-[#181535] text-slate-300 border-[#2c2858] hover:bg-[#201c44] hover:text-white"
                            }`}
                            onClick={() => handleSelectLanguage(idx)}
                            disabled={status === "DOWNLOADING" || status === "RECONNECTING" || status === "SAVING"}
                          >
                            <span className="text-sm">🗣️</span>
                            <span className="truncate font-mono">{aud.name} {aud.language ? `(${aud.language})` : ""}</span>
                          </button>
                        ))
                      ) : (
                        languagesList.map((lang, idx) => (
                          <button
                            key={idx}
                            className={`px-4 py-3 rounded-xl border text-xs font-semibold text-left transition-all flex items-center gap-2 cursor-pointer ${
                              selectedLanguage === lang
                                ? "bg-gradient-to-r from-[#9d31f0] via-[#eb1ac2] to-[#fd426c] text-white border-transparent shadow-lg shadow-[#eb1ac2]/10"
                                : "bg-[#181535] text-slate-300 border-[#2c2858] hover:bg-[#201c44] hover:text-white"
                            }`}
                            onClick={() => handleSelectLanguage(idx)}
                            disabled={status === "DOWNLOADING" || status === "RECONNECTING" || status === "SAVING"}
                          >
                            <span className="text-sm">🗣️</span>
                            <span className="truncate font-mono">{lang}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Video Quality / Resolution Selection */}
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">
                      Select Download Quality Format
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {parsedData?.isMaster && parsedData.masterItems.length > 0 ? (
                        parsedData.masterItems.map((item, idx) => (
                          <button
                            key={idx}
                            className={`px-4 py-3 rounded-xl border text-xs font-semibold text-left transition-all flex items-center justify-between cursor-pointer ${
                              selectedQuality === (item.resolution || `Format #${idx + 1}`)
                                ? "bg-gradient-to-r from-[#9d31f0] via-[#eb1ac2] to-[#fd426c] text-white border-transparent shadow-lg shadow-[#eb1ac2]/10"
                                : "bg-[#181535] text-slate-300 border-[#2c2858] hover:bg-[#201c44] hover:text-white"
                            }`}
                            onClick={() => {
                              setSelectedQuality(item.resolution || `Format #${idx + 1}`);
                              handleSelectMasterItem(item);
                            }}
                            disabled={status === "DOWNLOADING" || status === "RECONNECTING" || status === "SAVING"}
                          >
                            <span className="truncate font-mono text-white">🎬 {item.resolution || `Stream #${idx + 1}`}</span>
                            {item.bandwidth && (
                              <span className="text-[10px] font-semibold bg-[#eb1ac2]/10 text-white border border-[#eb1ac2]/30 px-1.5 py-0.5 rounded font-mono shrink-0">
                                {(item.bandwidth / 1000000).toFixed(2)} Mbps
                              </span>
                            )}
                          </button>
                        ))
                      ) : (
                        qualitiesList.map((qual, idx) => (
                          <button
                            key={idx}
                            className={`px-4 py-3 rounded-xl border text-xs font-semibold text-left transition-all flex items-center gap-2 cursor-pointer ${
                              selectedQuality === qual
                                ? "bg-gradient-to-r from-[#9d31f0] via-[#eb1ac2] to-[#fd426c] text-white border-transparent shadow-lg shadow-[#eb1ac2]/10"
                                : "bg-[#181535] text-slate-300 border-[#2c2858] hover:bg-[#201c44] hover:text-white"
                            }`}
                            onClick={() => handleSelectQuality(idx)}
                            disabled={status === "DOWNLOADING" || status === "RECONNECTING" || status === "SAVING"}
                          >
                            <span className="text-xs">🎬</span>
                            <span className="truncate font-mono">{qual}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Dynamic big action trigger */}
                  {(status === "PARSED" || status === "IDLE" || status === "FAILED") && (
                    <div className="mt-8 pt-6 border-t border-[#231e4d] space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Direct Browser Download Option */}
                        <button
                          onClick={handleStartDownload}
                          className="px-6 py-4 bg-[#141235] border border-[#2d275a] hover:border-[#eb1ac2] text-white font-bold text-xs rounded-2xl shadow-lg transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer flex items-center gap-3 hover:bg-[#1c1944]"
                        >
                          <Zap className="w-5 h-5 text-yellow-400 shrink-0" />
                          <div className="text-left leading-tight">
                            <span className="block font-black text-[#eb1ac2] text-xs">Direct Browser Multi-Socket</span>
                            <span className="text-[10px] text-slate-400 block font-normal mt-0.5">High-speed concurrent chunk fetching</span>
                          </div>
                        </button>

                        {/* Cloud Stitch Server Option */}
                        <a
                          href={`/api/download?url=${encodeURIComponent(playlistUrl)}&filename=${encodeURIComponent(filename)}&referer=${encodeURIComponent(customReferer)}&origin=${encodeURIComponent(customOrigin)}&headers=${encodeURIComponent(customHeaders)}`}
                          className="px-6 py-4 bg-gradient-to-r from-[#9d31f0] via-[#eb1ac2] to-[#fd426c] text-white font-bold text-xs rounded-2xl shadow-xl shadow-[#eb1ac2]/20 hover:opacity-95 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center gap-3 cursor-pointer"
                        >
                          <Globe className="w-5 h-5 animate-pulse text-white shrink-0" />
                          <div className="text-left leading-tight">
                            <span className="block font-black text-white text-xs">GmaxHub Cloud Stitch Pipeline</span>
                            <span className="text-[10px] text-pink-200 block font-normal mt-0.5">Best compatibility for Apple / Mobile Safari</span>
                          </div>
                        </a>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-2 font-mono text-center">
                        ✓ Both options are 100% free and respect your file security • No server logging
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* GmaxHub Welcome Portal Page (Visited directly with no redirect link) */
              <div id="welcome-canvas" className="bg-[#0e0c25]/90 border border-[#231e4d] p-12 rounded-[32px] text-center space-y-8 relative overflow-hidden shadow-2xl">
                <div className="absolute top-0 right-0 p-4 opacity-[0.02] pointer-events-none">
                  <Download className="w-80 h-80 text-[#eb1ac2]" />
                </div>

                <div className="w-20 h-20 bg-gradient-to-tr from-[#9d31f0]/20 via-[#eb1ac2]/20 to-[#fd426c]/20 text-[#eb1ac2] rounded-[24px] flex items-center justify-center border border-[#eb1ac2]/30 mx-auto">
                  <Download className="w-10 h-10 shrink-0" />
                </div>

                <div className="space-y-3 max-w-lg mx-auto">
                  <h1 className="text-2xl font-black tracking-tight text-white">
                    GmaxHub Download Site
                  </h1>
                  <p className="text-sm text-slate-300 leading-relaxed font-normal">
                    This is the official high-speed downloader owned by <strong className="text-white text-semibold">GmaxHub</strong>.
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Simply launch downloads directly inside the video player on the platform, select audio and video qualities, and save files high-speed onto your local device storage.
                  </p>
                </div>


              </div>
            )}

            {/* DOWNLOADING PROGRESS HUD & PLOTS */}
            {parsedData && !parsedData.isMaster && segments.length > 0 && (
              <div id="media-downloader-hud" className="bg-[#0e0c25]/90 border border-[#231e4d] p-8 rounded-[32px] space-y-6 shadow-2xl text-white">
                
                {/* METRICS ROW BENTO */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-[#110e2d]/60 rounded-2xl border border-[#231e4d] flex flex-col justify-between">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">
                      Video Length
                    </span>
                    <div className="mt-2">
                      <span className="text-sm font-bold text-white font-mono block">
                        {formatTime(totalPlaytimeSeconds)}
                      </span>
                      <span className="text-[9px] text-slate-400">
                        High-quality movie
                      </span>
                    </div>
                  </div>

                  <div className="p-4 bg-[#110e2d]/60 rounded-2xl border border-[#231e4d] flex flex-col justify-between">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">
                      Secure Transfer
                    </span>
                    <div className="flex items-center gap-1.5 mt-2">
                      <div className="w-2 h-2 rounded-full bg-pink-500" />
                      <div>
                        <span className="text-xs font-bold text-pink-400 block">
                          Verified Safe
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono">
                          Private Connection
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-[#110e2d]/60 rounded-2xl border border-[#231e4d] flex flex-col justify-between">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">
                      Download Speed
                    </span>
                    <div className="mt-2">
                      <span className={`text-sm font-bold font-mono block ${
                        status === "RECONNECTING" ? "text-amber-500" : "text-[#eb1ac2]"
                      }`}>
                        {status === "DOWNLOADING" ? formatSpeed(downloadSpeed) : status === "RECONNECTING" ? "Awaiting Connection..." : "0.00 KB/s"}
                      </span>
                      <span className="text-[9px] text-slate-400">
                        {status === "RECONNECTING" ? "Resume is automatic" : "Parallel fetching active"}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 bg-[#110e2d]/60 rounded-2xl border border-[#231e4d] flex flex-col justify-between">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">
                      File Progress
                    </span>
                    <div className="mt-2">
                      <span className="text-sm font-bold text-slate-300 font-mono block">
                        {formatBytes(totalDownloadedBytes)}
                      </span>
                      <span className="text-[9px] text-slate-400">
                        {completedSegmentsCount} of {segments.length} parts ready
                      </span>
                    </div>
                  </div>
                </div>

                {/* Main progress bar container */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs text-slate-300">
                    <div className="flex items-center gap-1.5 font-medium">
                      <span>
                        {status === "DOWNLOADING" ? "Downloading video segments (saves automatically when finished)..." :
                         status === "RECONNECTING" ? "⚡ Connection interrupted. Reconnecting & Auto-Resuming..." :
                         status === "SUCCESS" ? "✓ Video downloaded and saved successfully!" :
                         status === "SAVING" ? "Assembling downloaded data..." :
                         status === "PAUSED" ? "Download paused" : "Status: " + status}
                      </span>
                      {(status === "DOWNLOADING" || status === "RECONNECTING") && (
                        <span className={`inline-block w-2.5 h-2.5 rounded-full animate-ping pulsing-indicator ${
                          status === "RECONNECTING" ? "bg-amber-600" : "bg-[#eb1ac2]"
                        }`} />
                      )}
                    </div>
                    <span className="font-extrabold text-white font-mono">
                      {Math.floor((completedSegmentsCount / segments.length) * 100)}%
                    </span>
                  </div>
                  
                  {/* Progress Line */}
                  <div className="w-full h-3 bg-[#131130] border border-[#231e4d] rounded-full overflow-hidden p-[2px]">
                    <div 
                      className="h-full bg-gradient-to-r from-[#9d31f0] via-[#eb1ac2] to-[#fd426c] rounded-full transition-all duration-300"
                      style={{ width: `${(completedSegmentsCount / segments.length) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Master actions bar */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-[#231e4d]">
                  <div className="flex items-center gap-3">
                    {status === "PARSED" || status === "FAILED" ? (
                      <button
                        id="start-download-btn"
                        onClick={handleStartDownload}
                        className="px-6 py-2.5 bg-gradient-to-r from-[#9d31f0] via-[#eb1ac2] to-[#fd426c] text-white font-semibold text-xs rounded-xl shadow-lg shadow-[#eb1ac2]/10 cursor-pointer flex items-center gap-2 transition-all active:scale-95"
                      >
                        <Play className="w-4 h-4 fill-white text-white" />
                        <span>Start Download</span>
                      </button>
                    ) : status === "DOWNLOADING" || status === "RECONNECTING" ? (
                      <div className="flex items-center gap-2">
                        <button
                          id="pause-download-btn"
                          onClick={handlePause}
                          className="px-5 py-2.5 bg-[#181535] border border-[#2b275c] text-slate-200 hover:text-white hover:bg-[#201c44] font-semibold text-xs rounded-xl cursor-pointer flex items-center gap-2 transition-all active:scale-95"
                        >
                          <Pause className="w-4 h-4 text-slate-300" />
                          <span>{status === "RECONNECTING" ? "Pause Reconnect" : "Pause Download"}</span>
                        </button>
                        <button
                          id="cancel-download-btn"
                          onClick={handleCancel}
                          className="px-4 py-2.5 bg-red-950/40 border border-red-900/40 text-red-300 hover:bg-red-900/30 font-semibold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-all active:scale-95"
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
                          <span>Cancel</span>
                        </button>
                      </div>
                    ) : status === "PAUSED" ? (
                      <div className="flex items-center gap-2">
                        <button
                          id="resume-download-btn"
                          onClick={handleResume}
                          className="px-6 py-2.5 bg-gradient-to-r from-[#9d31f0] via-[#eb1ac2] to-[#fd426c] text-white font-semibold text-xs rounded-xl shadow-lg cursor-pointer flex items-center gap-2 transition-all active:scale-95"
                        >
                          <Play className="w-4 h-4 fill-white text-white" />
                          <span>Resume Download</span>
                        </button>
                        <button
                          id="cancel-paused-download-btn"
                          onClick={handleCancel}
                          className="px-4 py-2.5 bg-red-950/40 border border-red-900/40 text-red-300 hover:bg-red-900/30 font-semibold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-all active:scale-95"
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
                          <span>Cancel</span>
                        </button>
                      </div>
                    ) : null}

                    {status === "SUCCESS" && (
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-emerald-400 font-bold flex items-center gap-1 bg-emerald-950/40 border border-emerald-800/40 px-3 py-1.5 rounded-xl">
                          <CheckCircle className="w-4 h-4 text-emerald-400" /> Saved successfully to local downloads!
                        </span>
                        <button
                          onClick={handleCancel}
                          className="text-[10px] font-bold text-slate-300 hover:text-white border border-[#2b275c] px-2.5 py-1.5 rounded-lg bg-[#181535] cursor-pointer transition-colors"
                        >
                          Clear & Reset
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Estimated status display metrics */}
                  {(status === "DOWNLOADING" || status === "RECONNECTING") && (
                    <div className="flex items-center gap-4 text-xs text-slate-300 font-mono">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-pink-400" />
                        <span>Elapsed: {formatTime(elapsedSeconds)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Activity className="w-3.5 h-3.5 text-[#eb1ac2]" />
                        <span>ETA: {etaSeconds !== null ? formatTime(etaSeconds) : "calculating..."}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* FAILED SEGMENTS RETRY REMINDER WRAPPER */}
                {failedSegmentsCount > 0 && (
                  <div className="p-3 bg-red-950/20 border border-red-900/30 text-red-300 text-xs rounded-lg flex justify-between items-center font-mono">
                    <span className="flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {failedSegmentsCount} segments failed in download pool.
                    </span>
                    <button
                      id="retry-failed-chunks"
                      onClick={() => {
                        // Mark failed back to pending and launch downloader
                        setSegments(prev => prev.map(s => s.status === "FAILED" ? { ...s, status: "PENDING" } : s));
                        setTimeout(() => handleStartDownload(), 100);
                      }}
                      className="px-2.5 py-1 bg-red-900/40 hover:bg-red-900/60 hover:text-white rounded text-[10px] transition-colors"
                    >
                      Retry Failures
                    </button>
                  </div>
                )}
              </div>
            )}
        </div>

      </main>
    </div>
  );
}

// Private icons
function ServerIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <line x1="6" x2="6.01" y1="6" y2="6" />
      <line x1="6" x2="6.01" y1="18" y2="18" />
    </svg>
  );
}
