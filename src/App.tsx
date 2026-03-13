import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { BookOpen, Search, BookMarked, Settings, ArrowLeft, Key, ChevronDown, Copy, Check, Mail, Share2, Sparkles, PenLine } from 'lucide-react';
import {
    analyzeTextStream,
    listAvailableModels,
    PROMPT_WORDS_LONG,
    buildTutorPrompt,
    buildDeepReadPrompt,
    buildWritingPrompt,
    MODEL_DISPLAY_NAMES,
} from './lib/gemini';
import './App.css';

type FunctionType = 'words' | 'tutor' | 'deepread' | 'writing';
type AppView = 'main' | 'settings' | 'result';

// ==========================================
// English Tutor: 構造化データ型
// ==========================================
interface TutorSentence {
    original: string;
    natural: string;
    chunkedEn: string;
    chunkedJa: string;
}

// ==========================================
// Deep Read: 構造化データ型
// ==========================================
interface DeepSectionItem {
    type: 'section';
    title: string;
    para: string;
}

interface DeepSentenceItem {
    type: 'sentence';
    original: string;
    chunkedEn: string;
    translation: string;
    chunkedJa: string;
    tips: string;
    vocabulary?: string;
}

type DeepReadItem = DeepSectionItem | DeepSentenceItem;

// ==========================================
// HTML エスケープ / インライン書式
// ==========================================
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function applyInline(html: string): string {
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/"([^"]+)"/g, '<span class="phrase">"$1"</span>');
    html = html.replace(/`(.+?)`/g, "<code class='inline-code'>$1</code>");
    return html;
}

// ==========================================
// Words: Markdownフォーマッタ
// ==========================================
function formatMarkdown(text: string): string {
    if (text.includes('error-display')) return text;

    const lines = text.split('\n');
    const parts: string[] = [];
    let inBlockquote = false;
    let blockquoteLines: string[] = [];
    let inWordBlock = false;

    for (const line of lines) {
        if (line.trim() === '---' || line.trim() === '***' || line.trim() === '___') {
            if (inBlockquote) {
                parts.push(renderBlockquote(blockquoteLines));
                blockquoteLines = [];
                inBlockquote = false;
            }
            continue;
        }

        if (line.startsWith('> ')) {
            inBlockquote = true;
            blockquoteLines.push(line.slice(2));
            continue;
        } else if (inBlockquote) {
            parts.push(renderBlockquote(blockquoteLines));
            blockquoteLines = [];
            inBlockquote = false;
        }

        if (line.trim() === '') {
            if (parts.length > 0 && !parts[parts.length - 1].includes('spacer')) {
                parts.push('<div class="spacer"></div>');
            }
            continue;
        }

        const sectionMatch = line.match(/^【(.+?)】$/);
        if (sectionMatch) {
            parts.push(`<div class="section-header">${escapeHtml(sectionMatch[1])}</div>`);
            continue;
        }

        if (line.startsWith('## ')) {
            if (inWordBlock) parts.push('</div>');
            parts.push('<div class="word-block">');
            inWordBlock = true;
            parts.push(`<h2 class="result-h2">${applyInline(escapeHtml(line.slice(3)))}</h2>`);
            continue;
        }

        if (line.startsWith('💡')) {
            const content = escapeHtml(line.slice(2).trim());
            parts.push(`<div class="tip"><span class="tip-icon">💡</span><span>${applyInline(content)}</span></div>`);
            continue;
        }

        if (line.match(/^[-•]\s/)) {
            parts.push(`<div class="bullet-item"><span class="bullet-dot">•</span><span>${applyInline(escapeHtml(line.slice(2)))}</span></div>`);
            continue;
        }
        if (line.startsWith('・')) {
            const content = escapeHtml(line.slice(1));
            parts.push(`<div class="bullet-item"><span class="bullet-dot">•</span><span>${applyInline(content)}</span></div>`);
            continue;
        }

        if (line.startsWith('▶')) {
            const content = escapeHtml(line.slice(1).trim());
            parts.push(`<div class="usage-example"><span class="usage-mark">▶</span><span>${applyInline(content)}</span></div>`);
            continue;
        }

        if (line.startsWith('→')) {
            const content = escapeHtml(line.slice(1).trim());
            parts.push(`<div class="arrow-line">→ ${applyInline(content)}</div>`);
            continue;
        }

        const numMatch = line.match(/^(\d+)\.\s+(.+)$/);
        if (numMatch) {
            parts.push(`<div class="numbered-item"><span class="num">${numMatch[1]}.</span><span>${applyInline(escapeHtml(numMatch[2]))}</span></div>`);
            continue;
        }

        parts.push(`<div class="text-line">${applyInline(escapeHtml(line))}</div>`);
    }

    if (inBlockquote && blockquoteLines.length > 0) {
        parts.push(renderBlockquote(blockquoteLines));
    }
    if (inWordBlock) parts.push('</div>');

    return parts.join('');
}

function renderBlockquote(lines: string[]): string {
    const content = lines.map((text) => {
        let escaped = escapeHtml(text);
        return `<div class="tutor-line"><span>${escaped}</span></div>`;
    }).join('');
    return `<blockquote class="result-blockquote tutor-blockquote">${content}</blockquote>`;
}

function buildDeepReadHtmlForCopy(items: DeepReadItem[], showChunks: boolean): string {
    const parts: string[] = [];
    for (const item of items) {
        if (item.type === 'section') {
            if (item.title) parts.push(`<div style="font-weight:700;color:#222;margin:16px 0 4px;">${escapeHtml(item.title)}</div>`);
            if (item.para) parts.push(`<div style="color:#555;margin:4px 0 12px;line-height:1.6;">${escapeHtml(item.para)}</div>`);
        } else {
            const displayEn = showChunks && item.chunkedEn ? item.chunkedEn : item.original;
            const rawJa = showChunks ? (item.chunkedJa || item.translation) : item.translation;
            let transText = rawJa;
            let vocabLines: string[] = [];
            if (item.vocabulary && item.vocabulary.trim() !== '' && item.vocabulary.trim() !== 'なし') {
                vocabLines = item.vocabulary.split('\n').filter(l => l.trim() !== '' && l.trim() !== 'なし');
            } else {
                const lines = transText.split('\n').filter(l => l.trim() !== '');
                vocabLines = lines.filter(l => l.trim().startsWith('・') || l.trim().startsWith('•'));
                transText = lines.filter(l => !l.trim().startsWith('・') && !l.trim().startsWith('•')).join('\n');
            }
            parts.push(`<div style="border-left:3px solid #4a9eff;padding:4px 12px;margin:8px 0;color:#1a3a5c;">${escapeHtml(displayEn)}</div>`);
            parts.push(`<div style="color:#333;margin:4px 0;">${escapeHtml(transText)}</div>`);
            if (vocabLines.length > 0) {
                const vocabItems = vocabLines.map(line => {
                    const text = line.trim().replace(/^[・•\-*]\s*/, '');
                    return `<div style="color:#333;padding:2px 0;font-size:0.9em;">・${escapeHtml(text)}</div>`;
                }).join('');
                parts.push(`<div style="margin:8px 0;padding:6px 10px;background:#f5f5f5;border-radius:4px;"><div style="font-size:0.75em;font-weight:600;color:#555;margin-bottom:4px;">単語／イディオム</div>${vocabItems}</div>`);
            }
            if (item.tips && item.tips.trim() !== '' && item.tips.trim() !== 'なし') {
                parts.push(`<div style="margin:6px 0;"><div style="font-size:0.75em;font-weight:600;color:#555;margin-bottom:2px;">Tips</div><div style="color:#555;font-size:0.9em;">${escapeHtml(item.tips).replace(/\n/g, '<br>')}</div></div>`);
            }
            parts.push('<hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0;">');
        }
    }
    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans',sans-serif;line-height:1.7;color:#333;">${parts.join('')}</div>`;
}

// Words: Long結果からShort版を生成
function shortenWordsResult(longResult: string): string {
    const lines = longResult.split('\n');
    const kept: string[] = [];
    let inSection = '';
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.match(/^[-*_⸻—=]{3,}$/)) continue;
        if (line.startsWith('## ')) { kept.push(line); continue; }
        if (line.match(/^【発音記号】/)) { inSection = 'pron'; kept.push(line); continue; }
        if (line.match(/^【意味】/) || line.match(/^【英和辞典】/)) { inSection = 'ja'; kept.push(line); continue; }
        if (line.match(/^【英英辞典】|^【コロケーション|^【シチュエーション|^【同意語|^【覚えておくべき/)) { inSection = 'skip'; continue; }
        if (line.match(/^【/)) { inSection = 'other'; kept.push(line); continue; }
        if (inSection === 'pron' || inSection === 'ja' || inSection === 'other' || inSection === '') kept.push(line);
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ==========================================
// English Tutor: ストリームパーサー
// ==========================================
const memoizedTutorBlocks = new Map<string, TutorSentence>();

function parseTutorStream(text: string): { sentences: TutorSentence[]; preamble: string } {
    const preamble = text.split('[BLOCK_START]')[0].trim();
    const blocks = text.split('[BLOCK_START]');
    const sentences: TutorSentence[] = [];

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        if (!block.trim()) continue;
        const isLast = i === blocks.length - 1;

        if (!isLast && memoizedTutorBlocks.has(block)) {
            sentences.push(memoizedTutorBlocks.get(block)!);
            continue;
        }

        const original = block.match(/<original>([\s\S]*?)<\/original>/)?.[1]?.trim()
            || block.match(/<original>([\s\S]*?)(?:\[BLOCK_START]|<natural>|$)/)?.[1]?.trim() || '';
        const natural = block.match(/<natural>([\s\S]*?)<\/natural>/)?.[1]?.trim()
            || block.match(/<natural>([\s\S]*?)(?:\[BLOCK_START]|<chunked_en>|$)/)?.[1]?.trim() || '';
        const chunkedEn = block.match(/<chunked_en>([\s\S]*?)<\/chunked_en>/)?.[1]?.trim()
            || block.match(/<chunked_en>([\s\S]*?)(?:\[BLOCK_START]|<chunked_ja>|$)/)?.[1]?.trim() || '';
        const chunkedJa = block.match(/<chunked_ja>([\s\S]*?)<\/chunked_ja>/)?.[1]?.trim()
            || block.match(/<chunked_ja>([\s\S]*?)(?:\[BLOCK_START]|\[BLOCK_END]|\[\/BLOCK_END]|$)/)?.[1]?.trim() || '';

        const result: TutorSentence = { original, natural, chunkedEn, chunkedJa };
        if (!isLast && (block.includes('[/BLOCK_END]') || block.includes('[BLOCK_END]'))) {
            memoizedTutorBlocks.set(block, result);
        }
        sentences.push(result);
    }
    return { sentences, preamble };
}

// ==========================================
// Deep Read: ストリームパーサー
// ==========================================
const memoizedDeepBlocks = new Map<string, DeepReadItem>();

function parseSection(content: string): DeepSectionItem {
    const title = content.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim()
        || content.match(/<title>([\s\S]*?)(?:<\/title>|<para>|\[SECTION_END\]|$)/)?.[1]?.trim() || '';
    const para = content.match(/<para>([\s\S]*?)<\/para>/)?.[1]?.trim()
        || content.match(/<para>([\s\S]*?)(?:<\/para>|\[SECTION_END\]|$)/)?.[1]?.trim() || '';
    return { type: 'section', title, para };
}

function parseSentenceBlock(content: string): DeepSentenceItem {
    const original = content.match(/<original>([\s\S]*?)(?:<\/original>|$)/)?.[1]?.trim() || '';
    const chunkedEn = content.match(/<chunked_en>([\s\S]*?)(?:<\/chunked_en>|$)/)?.[1]?.trim() || '';
    const translation = content.match(/<(?:translation|natural)>([\s\S]*?)(?:<\/(?:translation|natural)>|$)/)?.[1]?.trim() || '';
    const chunkedJa = content.match(/<chunked_ja>([\s\S]*?)(?:<\/chunked_ja>|$)/)?.[1]?.trim() || '';
    const tips = content.match(/<tips>([\s\S]*?)(?:<\/tips>|\[BLOCK_END\]|$)/)?.[1]?.trim() || '';
    const vocabulary = content.match(/<vocabulary>([\s\S]*?)(?:<\/vocabulary>|$)/)?.[1]?.trim() || '';
    return { type: 'sentence', original, chunkedEn, translation, chunkedJa, tips, vocabulary };
}

function parseDeepReadStream(text: string): DeepReadItem[] {
    const items: DeepReadItem[] = [];
    const parts = text.split(/(\[SECTION_START\]|\[BLOCK_START\])/);
    for (let i = 1; i < parts.length; i += 2) {
        const marker = parts[i];
        const content = parts[i + 1] || '';
        const isLast = i >= parts.length - 2;
        const cacheKey = marker + content;
        if (!isLast && memoizedDeepBlocks.has(cacheKey)) {
            items.push(memoizedDeepBlocks.get(cacheKey)!);
            continue;
        }
        const item: DeepReadItem = marker === '[SECTION_START]'
            ? parseSection(content)
            : parseSentenceBlock(content);
        if (!isLast) memoizedDeepBlocks.set(cacheKey, item);
        items.push(item);
    }
    return items;
}

// ==========================================
// English Tutor: 文ブロック表示コンポーネント
// ==========================================
const TutorSentenceBlock = memo(({ sentence, showChunks }: {
    sentence: TutorSentence;
    showChunks: boolean;
}) => (
    <div className="sentence-block">
        <blockquote className="result-blockquote">
            <div className="tutor-line">
                <span dangerouslySetInnerHTML={{
                    __html: applyInline(escapeHtml(showChunks ? (sentence.chunkedEn || sentence.original) : sentence.original))
                        .replace(/／/g, '<span class="chunk-slash">／</span>')
                }} />
            </div>
        </blockquote>
        <div
            className={`text-line ${showChunks ? 'chunked-text' : 'natural-text'}`}
            dangerouslySetInnerHTML={{
                __html: applyInline(escapeHtml(showChunks ? (sentence.chunkedJa || sentence.natural) : sentence.natural))
                    .replace(/／/g, '<span class="chunk-slash">／</span>')
            }}
        />
        <hr className="result-hr" />
    </div>
));

// ==========================================
// Deep Read: 段落ブロック表示コンポーネント
// ==========================================
const DeepSectionBlock = memo(({ item }: { item: DeepSectionItem }) => (
    <div className="dr-section-block">
        {item.title && <div className="dr-section-title">{item.title}</div>}
        {item.para && <div className="dr-para-box">{item.para}</div>}
    </div>
));

// ==========================================
// Deep Read: 文ブロック表示コンポーネント
// ==========================================
const DeepSentenceBlock = memo(({ item, showChunks }: {
    item: DeepSentenceItem;
    showChunks: boolean;
}) => {
    const displayEn = showChunks && item.chunkedEn ? item.chunkedEn : item.original;
    const displayJa = showChunks ? (item.chunkedJa || item.translation) : item.translation;

    // 語彙行の抽出
    let vocabLines: string[] = [];
    let transText = displayJa;
    if (item.vocabulary && item.vocabulary !== 'なし') {
        vocabLines = item.vocabulary.split('\n').filter(l => l.trim() !== '' && l.trim() !== 'なし');
    } else {
        const lines = transText.split('\n').filter(l => l.trim() !== '');
        vocabLines = lines.filter(l => l.trim().startsWith('・') || l.trim().startsWith('•'));
        transText = lines.filter(l => !l.trim().startsWith('・') && !l.trim().startsWith('•')).join('\n');
    }

    let formattedTrans = escapeHtml(transText);
    if (showChunks) {
        formattedTrans = formattedTrans.replace(/[／/]/g, '<span class="chunk-slash">／</span>');
    } else {
        formattedTrans = formattedTrans.replace(/[／/]/g, '');
    }

    return (
        <div className="dr-sentence-block">
            <blockquote className="dr-original-quote">
                <div className="tutor-line">
                    <span dangerouslySetInnerHTML={{
                        __html: escapeHtml(displayEn).replace(/[／/]/g, showChunks ? '<span class="chunk-slash">／</span>' : ' ')
                    }} />
                </div>
            </blockquote>
            <div
                className={`text-line ${showChunks ? 'chunked-text' : 'natural-text'}`}
                dangerouslySetInnerHTML={{ __html: formattedTrans }}
            />
            {vocabLines.length > 0 && (
                <div className="dr-vocab-section">
                    <div className="dr-label">単語／イディオム</div>
                    {vocabLines.map((line, idx) => (
                        <div key={idx} className="dr-vocab-item">{line.trim().replace(/^[・•\-*]\s*/, '')}</div>
                    ))}
                </div>
            )}
            {item.tips && item.tips !== 'なし' && (
                <div className="dr-tips">
                    <div><span className="dr-label tips">Tips</span></div>
                    <div className="dr-tips-text">{item.tips}</div>
                </div>
            )}
            <hr className="result-hr" />
        </div>
    );
});

// ==========================================
// English Writing: 型・パーサー・コンポーネント
// ==========================================
interface WritingPattern {
    en: string;
    translation: string;
    explanation: string;
}
interface WritingResult {
    writing: WritingPattern[];
    speaking: WritingPattern[];
}

function parseWritingResult(text: string): WritingResult {
    const writingSection = text.match(/\[WRITING_START\]([\s\S]*?)(?:\[WRITING_END\]|$)/)?.[1] || '';
    const speakingSection = text.match(/\[SPEAKING_START\]([\s\S]*?)(?:\[SPEAKING_END\]|$)/)?.[1] || '';
    function parsePatterns(section: string): WritingPattern[] {
        const patterns: WritingPattern[] = [];
        const parts = section.split(/<pattern\d+>/);
        for (let i = 1; i < parts.length; i++) {
            const content = parts[i].replace(/<\/pattern\d+>[\s\S]*/, '');
            const en = content.match(/<en>([\s\S]*?)(?:<\/en>|$)/)?.[1]?.trim() || '';
            const translation = content.match(/<translation>([\s\S]*?)(?:<\/translation>|$)/)?.[1]?.trim() || '';
            const explanation = content.match(/<explanation>([\s\S]*?)(?:<\/explanation>|$)/)?.[1]?.trim() || '';
            if (en) patterns.push({ en, translation, explanation });
        }
        return patterns;
    }
    return { writing: parsePatterns(writingSection), speaking: parsePatterns(speakingSection) };
}

function renderExplanation(text: string): React.ReactNode {
    if (!text) return null;
    return text.split('\n').map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const bulletMatch = trimmed.match(/^[•・]\s*(.+)/);
        if (bulletMatch) {
            const content = bulletMatch[1];
            const colonIdx = content.indexOf(':');
            if (colonIdx > -1) {
                const term = content.slice(0, colonIdx).trim();
                const desc = content.slice(colonIdx + 1).trim();
                return (
                    <div key={i} className="writing-explanation-item">
                        <span className="writing-explanation-term">{term}</span>
                        <span className="writing-explanation-desc">{desc}</span>
                    </div>
                );
            }
            return <div key={i} className="writing-explanation-item"><span className="writing-explanation-desc">{content}</span></div>;
        }
        return <div key={i} className="writing-explanation-item"><span className="writing-explanation-desc">{trimmed}</span></div>;
    });
}

const WritingResultDisplay = memo(({ result, mode }: { result: WritingResult; mode: 'writing' | 'speaking' }) => {
    const patterns = mode === 'writing' ? result.writing : result.speaking;
    const label = mode === 'writing' ? 'Writing' : 'Speaking';
    if (patterns.length === 0) return <div className="text-line" style={{ color: 'var(--text-secondary)', padding: '12px 0' }}>解析中...</div>;
    return (
        <div className="writing-result">
            {patterns.map((p, i) => (
                <div key={i} className="writing-pattern-block">
                    <div className="writing-pattern-header">{label} {i + 1}</div>
                    <div className="writing-pattern-en">{p.en}</div>
                    {p.translation && (
                        <div className="writing-pattern-translation">
                            <span className="writing-translation-label">日本語訳</span>
                            <span className="writing-translation-text">{p.translation}</span>
                        </div>
                    )}
                    {p.explanation && (
                        <div className="writing-pattern-explanation">
                            <div className="writing-explanation-label">表現解説</div>
                            <div className="writing-explanation-list">
                                {renderExplanation(p.explanation)}
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
});

// ==========================================
// メインコンポーネント
// ==========================================
function App() {
    const [view, setView] = useState<AppView>('main');
    const [resultContent, setResultContent] = useState('');
    const [tutorSentences, setTutorSentences] = useState<TutorSentence[]>([]);
    const [tutorPreamble, setTutorPreamble] = useState('');
    const [deepReadItems, setDeepReadItems] = useState<DeepReadItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isDone, setIsDone] = useState(false);
    const [activeFunction, setActiveFunction] = useState<FunctionType | null>(null);
    const [errorMessage, setErrorMessage] = useState('');

    // Settings
    const [apiKey, setApiKey] = useState(localStorage.getItem('lingodesk_apikey') || '');
    const [model, setModel] = useState(localStorage.getItem('lingodesk_model') || 'gemini-3-flash-preview');
    const [shareEmail, setShareEmail] = useState(localStorage.getItem('lingodesk_share_email') || '');
    const [showApiKey, setShowApiKey] = useState(false);
    const [settingsStatus, setSettingsStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // CEFR level
    const [cefrLevel, setCefrLevel] = useState(localStorage.getItem('lingodesk_cefr') || 'B1');

    const [sourceText, setSourceText] = useState('');

    // Model selection
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const fetchingModelsRef = useRef(false);
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

    // Chunk表示切替
    const [showChunks, setShowChunks] = useState(false);

    // Words: Long/Short切替
    const [wordsMode, setWordsMode] = useState<'long' | 'short'>('long');
    const [wordsFullResult, setWordsFullResult] = useState('');
    const [writingResult, setWritingResult] = useState<WritingResult | null>(null);
    const [writingMode, setWritingMode] = useState<'writing' | 'speaking'>('writing');

    const [copySuccess, setCopySuccess] = useState(false);

    const resultRef = useRef<HTMLDivElement>(null);
    const activeRequestIdRef = useRef<number>(0);

    // 初期化（一度だけ実行）
    useEffect(() => {
        if (!localStorage.getItem('lingodesk_apikey')) {
            setView('settings');
        }
    }, []);

    // ドロップダウンの外クリックで閉じる
    useEffect(() => {
        if (!modelDropdownOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            const container = document.getElementById('model-selector-container');
            if (container && !container.contains(e.target as Node)) {
                setModelDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => { document.removeEventListener('mousedown', handleClickOutside); };
    }, [modelDropdownOpen]);

    // モデル一覧取得
    const fetchModels = useCallback(async () => {
        const key = localStorage.getItem('lingodesk_apikey');
        if (!key || fetchingModelsRef.current) return;
        fetchingModelsRef.current = true;
        setLoadingModels(true);
        try {
            const models = await listAvailableModels(key);
            setAvailableModels(models);
            if (models.length > 0 && !models.includes(model)) {
                setModel(models[0]);
                localStorage.setItem('lingodesk_model', models[0]);
            }
        } catch (err) {
            console.error('Failed to fetch models:', err);
        } finally {
            fetchingModelsRef.current = false;
            setLoadingModels(false);
        }
    }, [model]);

    useEffect(() => {
        if (view === 'main' && localStorage.getItem('lingodesk_apikey')) {
            fetchModels();
        }
    }, [view, fetchModels]);

    // 結果画面表示時はトップにスクロール
    useEffect(() => {
        if (view === 'result' && resultRef.current) {
            resultRef.current.scrollTop = 0;
            window.scrollTo(0, 0);
        }
    }, [view]);

    // ==========================================
    // API呼び出し
    // ==========================================
    const handleExecute = async (type: FunctionType) => {
        if (!sourceText.trim()) return;
        const storedKey = localStorage.getItem('lingodesk_apikey');
        if (!storedKey) { setView('settings'); return; }

        memoizedTutorBlocks.clear();
        memoizedDeepBlocks.clear();

        const activeModel = model;
        const requestId = Date.now();
        activeRequestIdRef.current = requestId;

        setActiveFunction(type);
        setView('result');
        setResultContent('');
        setTutorSentences([]);
        setTutorPreamble('');
        setDeepReadItems([]);
        setWordsFullResult('');
        setWordsMode('long');
        setWritingResult(null);
        setWritingMode('writing');
        setShowChunks(false);
        setIsLoading(true);
        setIsDone(false);
        setErrorMessage('');

        const promptMap: Record<FunctionType, string> = {
            words: PROMPT_WORDS_LONG,
            tutor: buildTutorPrompt(cefrLevel),
            deepread: buildDeepReadPrompt(cefrLevel),
            writing: buildWritingPrompt(cefrLevel),
        };

        try {
            const finalResult = await analyzeTextStream(
                storedKey,
                sourceText,
                promptMap[type],
                activeModel,
                (accumulated) => {
                    if (activeRequestIdRef.current !== requestId) return false;
                    if (type === 'tutor') {
                        const { sentences, preamble } = parseTutorStream(accumulated);
                        setTutorSentences(sentences);
                        setTutorPreamble(preamble);
                    } else if (type === 'deepread') {
                        setDeepReadItems(parseDeepReadStream(accumulated));
                    } else if (type === 'writing') {
                        setWritingResult(parseWritingResult(accumulated));
                    } else {
                        setResultContent(accumulated);
                    }
                }
            );

            if (activeRequestIdRef.current !== requestId) return;

            if (type === 'tutor') {
                const { sentences, preamble } = parseTutorStream(finalResult);
                setTutorSentences(sentences);
                setTutorPreamble(preamble);
            } else if (type === 'deepread') {
                setDeepReadItems(parseDeepReadStream(finalResult));
            } else if (type === 'writing') {
                setWritingResult(parseWritingResult(finalResult));
            } else {
                const cleaned = finalResult.replace(
                    /^(はい、承知いたしました。|承知いたしました。|かしこまりました。|OK、|Certainly!|Sure!)[^\n]*\n*/i, ''
                );
                setResultContent(cleaned);
                setWordsFullResult(cleaned);
            }

            setIsDone(true);
        } catch (err: any) {
            if (activeRequestIdRef.current !== requestId) return;
            const msg = err?.message || '不明なエラーが発生しました';
            const isQuotaError = msg.includes('[RESOURCE_EXHAUSTED]') || msg.includes('429') || msg.includes('quota');
            const isAuthError = msg.includes('[AUTH_ERROR]') || msg.includes('API key') || msg.includes('401') || msg.includes('403');
            const isOverloaded = msg.includes('[OVERLOADED]') || msg.includes('503');

            if (isAuthError) {
                setErrorMessage('APIキーが無効です。設定画面でAPIキーを確認してください。');
            } else if (isQuotaError) {
                setErrorMessage(`${MODEL_DISPLAY_NAMES[activeModel] || activeModel} の使用回数が上限に達しました。別のモデルをドロップダウンから選択してください。`);
            } else if (isOverloaded) {
                setErrorMessage(`${MODEL_DISPLAY_NAMES[activeModel] || activeModel} は現在混雑しています。しばらく待つか別のモデルをお試しください。`);
            } else if (msg.includes('[SAFETY_ERROR]')) {
                setErrorMessage('安全フィルターにより内容がブロックされました。入力を調整してください。');
            } else if (msg.includes('404') || msg.includes('not found')) {
                setErrorMessage(`モデル「${MODEL_DISPLAY_NAMES[activeModel] || activeModel}」が見つかりません。別のモデルを選択してください。`);
            } else {
                setErrorMessage('エラーが発生しました。しばらく待ってからもう一度お試しください。');
            }
        } finally {
            setIsLoading(false);
        }
    };

    // ==========================================
    // 設定保存
    // ==========================================
    const handleSaveSettings = () => {
        if (!apiKey.trim()) {
            setSettingsStatus({ type: 'error', text: 'APIキーを入力してください' });
            return;
        }
        localStorage.setItem('lingodesk_apikey', apiKey.trim());
        localStorage.setItem('lingodesk_model', model);
        localStorage.setItem('lingodesk_share_email', shareEmail.trim());
        setSettingsStatus({ type: 'success', text: '✓ 設定を保存しました！' });
        setTimeout(() => {
            setSettingsStatus(null);
            setView('main');
        }, 1500);
    };

    // ブラウザ戻るボタン対策
    useEffect(() => {
        if (view !== 'main') {
            window.history.pushState(null, '', window.location.href);
        }
    }, [view]);

    useEffect(() => {
        const handlePopState = () => {
            activeRequestIdRef.current = 0;
            setView('main');
            setResultContent('');
            setTutorSentences([]);
            setTutorPreamble('');
            setDeepReadItems([]);
            setWordsFullResult('');
            setWordsMode('long');
            setActiveFunction(null);
            setIsLoading(false);
            setIsDone(false);
            setErrorMessage('');
        };
        window.addEventListener('popstate', handlePopState);
        return () => { window.removeEventListener('popstate', handlePopState); };
    }, []);

    // ==========================================
    // コピー / シェア
    // ==========================================
    const getResultText = useCallback((): string => {
        if (activeFunction === 'tutor') {
            const lines: string[] = [];
            if (tutorPreamble) lines.push(tutorPreamble, '');
            for (const s of tutorSentences) {
                lines.push(showChunks ? (s.chunkedEn || s.original) : s.original);
                lines.push(showChunks ? (s.chunkedJa || s.natural) : s.natural);
                lines.push('');
            }
            return lines.join('\n').trim();
        }
        if (activeFunction === 'deepread') {
            return deepReadItems.map(item => {
                if (item.type === 'section') {
                    return [item.title, item.para].filter(Boolean).join('\n');
                }
                const en = showChunks ? (item.chunkedEn || item.original) : item.original;
                const rawJa = showChunks ? (item.chunkedJa || item.translation) : item.translation;
                let transText = rawJa;
                let vocabText = '';
                if (item.vocabulary && item.vocabulary.trim() !== '' && item.vocabulary.trim() !== 'なし') {
                    vocabText = '【単語／イディオム】\n' + item.vocabulary;
                } else {
                    const lines = transText.split('\n').filter(l => l.trim() !== '');
                    const vocabLines = lines.filter(l => l.trim().startsWith('・') || l.trim().startsWith('•'));
                    if (vocabLines.length > 0) {
                        vocabText = '【単語／イディオム】\n' + vocabLines.join('\n');
                        transText = lines.filter(l => !l.trim().startsWith('・') && !l.trim().startsWith('•')).join('\n');
                    }
                }
                const tipsText = (item.tips && item.tips.trim() !== 'なし') ? item.tips : '';
                return [en, transText, vocabText, tipsText].filter(Boolean).join('\n');
            }).join('\n\n');
        }
        if (activeFunction === 'writing' && writingResult) {
            const patterns = writingMode === 'writing' ? writingResult.writing : writingResult.speaking;
            const label = writingMode === 'writing' ? 'Writing' : 'Speaking';
            return patterns.map((p, i) => `【${label} ${i + 1}】\n${p.en}${p.translation ? '\n' + p.translation : ''}${p.explanation ? '\n\n[解説]\n' + p.explanation : ''}`).join('\n\n');
        }
        if (activeFunction === 'words' && wordsMode === 'short' && wordsFullResult) {
            return shortenWordsResult(wordsFullResult);
        }
        return resultContent;
    }, [activeFunction, tutorSentences, tutorPreamble, deepReadItems, showChunks, wordsMode, wordsFullResult, resultContent, writingResult, writingMode]);

    const copyRichText = useCallback(async (): Promise<boolean> => {
        const plainText = getResultText();
        if (!plainText) return false;
        let htmlContent: string;
        if (activeFunction === 'deepread') {
            htmlContent = buildDeepReadHtmlForCopy(deepReadItems, showChunks);
        } else if (activeFunction === 'writing' && writingResult) {
            const patterns = writingMode === 'writing' ? writingResult.writing : writingResult.speaking;
            const modeLabel = writingMode === 'writing' ? 'Writing' : 'Speaking';
            const parts = patterns.map((p, i) =>
                `<div style="margin:12px 0;padding:12px 14px;border-left:3px solid #4a9eff;background:#f8faff;border-radius:0 6px 6px 0;"><div style="font-size:0.75em;font-weight:700;color:#4a9eff;margin-bottom:6px;">${modeLabel} ${i + 1}</div><div style="color:#1a3a5c;font-size:1em;line-height:1.7;">${escapeHtml(p.en)}</div>${p.translation ? `<div style="color:#333;font-size:0.9em;margin-top:8px;padding:6px 10px;background:#eef2ff;border-radius:4px;">${escapeHtml(p.translation)}</div>` : ''}${p.explanation ? `<div style="color:#555;font-size:0.82em;margin-top:8px;padding-top:8px;border-top:1px solid #dde6ff;white-space:pre-line;">${escapeHtml(p.explanation)}</div>` : ''}</div>`
            ).join('');
            htmlContent = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans',sans-serif;line-height:1.7;color:#333;">${parts}</div>`;
        } else {
            const resultEl = resultRef.current;
            if (!resultEl) return false;
            const html = resultEl.innerHTML;
            const normalizedHtml = html
                .replace(/<blockquote[^>]*>/g, '<div style="margin:0;padding:0;border:none;">')
                .replace(/<\/blockquote>/g, '</div>');
            htmlContent = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans',sans-serif;line-height:1.7;">${normalizedHtml}</div>`;
        }
        try {
            const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
            const textBlob = new Blob([plainText], { type: 'text/plain' });
            await navigator.clipboard.write([
                new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })
            ]);
            return true;
        } catch {
            await navigator.clipboard.writeText(plainText);
            return true;
        }
    }, [activeFunction, deepReadItems, showChunks, writingResult, writingMode, getResultText]);

    const handleMemo = useCallback(async () => {
        const text = getResultText();
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch { /* ignore */ }
    }, [getResultText]);

    const handleOpenGmail = useCallback(async () => {
        const text = getResultText();
        if (!text) return;
        const to = localStorage.getItem('lingodesk_share_email') || '';
        const fnLabel = activeFunction === 'deepread' ? 'Deep Read 解析結果' : 'LingoDesk 結果';
        const subject = encodeURIComponent(fnLabel);
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        try {
            await copyRichText();
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (_) { /* ignore */ }
        if (isMobile) {
            window.location.href = `mailto:${to}?subject=${subject}`;
        } else {
            window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${subject}`, '_blank');
        }
    }, [getResultText, copyRichText, activeFunction]);

    const handleNativeShare = useCallback(async () => {
        const text = getResultText();
        if (!text || !navigator.share) return;
        try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
        try { await navigator.share({ title: 'LingoDesk Pro 結果', text }); } catch (_) { /* cancel */ }
    }, [getResultText]);

    const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

    // ==========================================
    // 表示用ヘルパー
    // ==========================================
    const displayModel = MODEL_DISPLAY_NAMES[model] || model;

    const functionLabel: Record<FunctionType, string> = {
        words: 'Words',
        tutor: 'Quick Read',
        deepread: 'Deep Read',
        writing: 'Translation',
    };

    const CEFR_OPTIONS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

    // ==========================================
    // 設定画面
    // ==========================================
    if (view === 'settings') {
        return (
            <div className="lingodesk-container">
                <header className="lingodesk-header">
                    <div className="header-brand">
                        <div className="logo-icon"><Sparkles size={24} /></div>
                        <h1>LingoDesk(pro)</h1>
                    </div>
                    {localStorage.getItem('lingodesk_apikey') && (
                        <button className="back-btn" onClick={() => { setView('main'); setIsLoading(false); setErrorMessage(''); }}>
                            <ArrowLeft size={18} /><span>戻る</span>
                        </button>
                    )}
                </header>
                <main className="lingodesk-main">
                    <div className="canvas-card settings-card">
                        <div className="canvas-header">
                            <h2><Key size={15} /> API設定</h2>
                        </div>
                        <div className="settings-form">
                            <div className="form-group">
                                <label>Gemini API Key</label>
                                <p className="form-hint">
                                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a> でAPIキーを取得して入力してください。
                                </p>
                                <div className="input-row">
                                    <input
                                        type={showApiKey ? 'text' : 'password'}
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        placeholder="AIza..."
                                        className="api-input"
                                    />
                                    <button type="button" className="toggle-btn" onClick={() => setShowApiKey(!showApiKey)}>
                                        {showApiKey ? '隠す' : '表示'}
                                    </button>
                                </div>
                            </div>
                            <div className="form-group">
                                <label>送信先メールアドレス（任意）</label>
                                <p className="form-hint">Gmailボタンを使う場合、宛先として自動入力されます。</p>
                                <input
                                    type="email"
                                    value={shareEmail}
                                    onChange={(e) => setShareEmail(e.target.value)}
                                    placeholder="example@gmail.com"
                                    className="api-input"
                                />
                            </div>
                            <button className="save-btn" onClick={handleSaveSettings}>保存して開始</button>
                            {settingsStatus && (
                                <div className={`settings-status ${settingsStatus.type}`}>{settingsStatus.text}</div>
                            )}
                        </div>
                    </div>
                </main>
                <footer className="lingodesk-footer">
                    <span className="footer-glow">LINGODESK PRO • NEURAL LANGUAGE WORKSTATION</span>
                </footer>
            </div>
        );
    }

    // ==========================================
    // 結果画面
    // ==========================================
    if (view === 'result' && activeFunction) {
        const displayContent = activeFunction === 'words' && wordsMode === 'short' && wordsFullResult
            ? shortenWordsResult(wordsFullResult)
            : resultContent;

        return (
            <div className="lingodesk-container">
                <header className="lingodesk-header result-header">
                    <div className="header-brand">
                        <button className="back-btn" onClick={() => {
                            activeRequestIdRef.current = 0;
                            setView('main');
                            setResultContent('');
                            setTutorSentences([]);
                            setTutorPreamble('');
                            setDeepReadItems([]);
                            setWordsFullResult('');
                            setWordsMode('long');
                            setWritingResult(null);
                            setWritingMode('writing');
                            setActiveFunction(null);
                            setIsLoading(false);
                            setIsDone(false);
                            setErrorMessage('');
                        }}>
                            <ArrowLeft size={18} />
                        </button>
                        <div className="logo-icon small"><Sparkles size={18} /></div>
                        <h1>{functionLabel[activeFunction]}</h1>
                        {isLoading && (
                            <div className="loading-display mini" style={{ marginLeft: '12px' }}>
                                <div className="spinner small" />
                                <span>解析中...</span>
                            </div>
                        )}
                    </div>
                    <div className="header-right">
                        <div className="header-btn-group">
                            {activeFunction === 'writing' && isDone && !errorMessage && (
                                <button
                                    className={`mode-toggle-btn ${writingMode === 'speaking' ? 'active' : ''}`}
                                    onClick={() => setWritingMode(writingMode === 'writing' ? 'speaking' : 'writing')}
                                >
                                    {writingMode === 'writing' ? '✏️ Writing' : '🗣️ Speaking'}
                                </button>
                            )}
                            {(activeFunction === 'tutor' || activeFunction === 'deepread') && (
                                <button
                                    className={`mode-toggle-btn ${showChunks ? 'active' : ''}`}
                                    onClick={() => setShowChunks(!showChunks)}
                                >
                                    ／ Chunk {showChunks ? 'ON' : 'OFF'}
                                </button>
                            )}
                            {activeFunction === 'words' && isDone && (
                                <button
                                    className={`mode-toggle-btn ${wordsMode === 'short' ? 'active' : ''}`}
                                    onClick={() => setWordsMode(wordsMode === 'long' ? 'short' : 'long')}
                                >
                                    {wordsMode === 'long' ? '📖 Long' : '📋 Short'}
                                </button>
                            )}
                            {isDone && !errorMessage && (
                                <button
                                    className={`mode-toggle-btn ${copySuccess ? 'active' : ''}`}
                                    onClick={handleMemo}
                                    title="テキストをメモにコピー"
                                >
                                    {copySuccess ? <Check size={14} /> : <Copy size={14} />}
                                    <span>{copySuccess ? 'コピー済' : 'メモ'}</span>
                                </button>
                            )}
                        </div>
                        {isDone && !errorMessage && (
                            <div className="header-btn-group">
                                <button className="mode-toggle-btn" onClick={handleOpenGmail} title="Gmailで送る">
                                    <Mail size={14} /><span>Gmail</span>
                                </button>
                                {canNativeShare && (
                                    <button className="mode-toggle-btn" onClick={handleNativeShare} title="共有">
                                        <Share2 size={14} /><span>共有</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </header>

                <div className="source-preview">
                    {sourceText.length > 120 ? sourceText.substring(0, 120) + '…' : sourceText}
                </div>

                <main className="result-main" ref={resultRef}>
                    {errorMessage ? (
                        <div className="error-display">
                            <div className="error-icon">⚠️</div>
                            <div className="error-text">{errorMessage}</div>
                            <button className="retry-btn" onClick={() => handleExecute(activeFunction)}>再試行</button>
                        </div>
                    ) : activeFunction === 'tutor' ? (
                        <div className="result-content">
                            {tutorPreamble && (
                                <div className="text-line" style={{ fontStyle: 'italic', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}
                                    dangerouslySetInnerHTML={{ __html: applyInline(escapeHtml(tutorPreamble)) }}
                                />
                            )}
                            {tutorSentences.map((s, i) => (
                                <TutorSentenceBlock key={i} sentence={s} showChunks={showChunks} />
                            ))}
                        </div>
                    ) : activeFunction === 'deepread' ? (
                        <div className="dr-result">
                            {deepReadItems.map((item, i) =>
                                item.type === 'section'
                                    ? <DeepSectionBlock key={i} item={item} />
                                    : <DeepSentenceBlock key={i} item={item} showChunks={showChunks} />
                            )}
                        </div>
                    ) : activeFunction === 'writing' ? (
                        <WritingResultDisplay result={writingResult || { writing: [], speaking: [] }} mode={writingMode} />
                    ) : displayContent ? (
                        <div className="result-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(displayContent) }} />
                    ) : isDone ? (
                        <div className="error-display">
                            <div className="error-icon">⚠️</div>
                            <div className="error-text">結果を取得できませんでした。モデルを変更するか、再試行してください。</div>
                            <button className="retry-btn" onClick={() => handleExecute(activeFunction)}>再試行</button>
                        </div>
                    ) : null}
                </main>

                <footer className="lingodesk-footer">
                    <span className="footer-glow">
                        LINGODESK PRO • {functionLabel[activeFunction].toUpperCase()} • {displayModel}
                        {(activeFunction === 'tutor' || activeFunction === 'deepread' || activeFunction === 'writing') ? ` • CEFR ${cefrLevel}` : ''}
                    </span>
                </footer>
            </div>
        );
    }

    // ==========================================
    // メイン画面
    // ==========================================
    return (
        <div className="lingodesk-container">
            <header className="lingodesk-header">
                <div className="header-brand">
                    <div className="logo-icon"><Sparkles size={24} /></div>
                    <h1>LingoDesk(pro)</h1>
                </div>
                <div className="header-right">
                    <button className="settings-btn" onClick={() => setView('settings')} title="設定">
                        <Settings size={20} />
                    </button>
                </div>
            </header>

            <main className="lingodesk-main">
                <div className="canvas-card">
                    <div className="canvas-header">
                        <h2>INPUT TEXT</h2>
                        <div className="canvas-header-right">
                            <button
                                className="clear-btn"
                                style={{ visibility: sourceText ? 'visible' : 'hidden' }}
                                onClick={() => setSourceText('')}
                            >Clear</button>

                            {/* CEFRレベル選択 */}
                            <div className="cefr-selector-wrap">
                                <select
                                    className="cefr-selector"
                                    value={cefrLevel}
                                    onChange={(e) => {
                                        setCefrLevel(e.target.value);
                                        localStorage.setItem('lingodesk_cefr', e.target.value);
                                    }}
                                >
                                    {CEFR_OPTIONS.map(opt => (
                                        <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                </select>
                            </div>

                            {/* モデル選択ドロップダウン */}
                            <div className="model-selector" id="model-selector-container">
                                <button
                                    className="model-selector-btn"
                                    onClick={() => {
                                        setModelDropdownOpen(!modelDropdownOpen);
                                        if (!modelDropdownOpen) fetchModels();
                                    }}
                                >
                                    <span className="model-name">{displayModel}</span>
                                    <ChevronDown size={14} className={modelDropdownOpen ? 'rotate-180' : ''} />
                                </button>
                                {modelDropdownOpen && (
                                    <div className="model-dropdown">
                                        <div className="model-dropdown-header">
                                            <span>Select AI Model</span>
                                        </div>
                                        {loadingModels ? (
                                            <div className="model-dropdown-loading">更新中...</div>
                                        ) : (
                                            availableModels.map(m => (
                                                <button
                                                    key={m}
                                                    className={`model-option ${m === model ? 'active' : ''}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setModel(m);
                                                        localStorage.setItem('lingodesk_model', m);
                                                        setModelDropdownOpen(false);
                                                    }}
                                                >
                                                    <span className="model-option-name">{MODEL_DISPLAY_NAMES[m] || m}</span>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="input-workspace">
                        <textarea
                            className="main-textarea"
                            placeholder=""
                            value={sourceText}
                            onChange={(e) => setSourceText(e.target.value)}
                        />
                    </div>

                    <div className="action-panel">
                        <h3 className="panel-title">CHOOSE AI FUNCTION</h3>
                        <div className="button-group">
                            <button
                                className="action-btn words-btn"
                                onClick={() => handleExecute('words')}
                                disabled={!sourceText.trim() || isLoading}
                            >
                                <Search size={20} />
                                <span>Words<br /><small>単語と熟語の解説</small></span>
                            </button>
                            <button
                                className="action-btn tutor-btn"
                                onClick={() => handleExecute('tutor')}
                                disabled={!sourceText.trim() || isLoading}
                            >
                                <BookOpen size={20} />
                                <span>Quick Read<br /><small>英文１行解析</small></span>
                            </button>
                            <button
                                className="action-btn deepread-btn"
                                onClick={() => handleExecute('deepread')}
                                disabled={!sourceText.trim() || isLoading}
                            >
                                <BookMarked size={20} />
                                <span>Deep Read<br /><small>英文詳細解析</small></span>
                            </button>
                            <button
                                className="action-btn writing-btn"
                                onClick={() => handleExecute('writing')}
                                disabled={!sourceText.trim() || isLoading}
                            >
                                <PenLine size={20} />
                                <span>Translation<br /><small>日本語を英語に変換</small></span>
                            </button>
                        </div>
                    </div>

                    {errorMessage && view === 'main' && (
                        <div className="error-toast">⚠️ {errorMessage}</div>
                    )}
                </div>
            </main>

            <footer className="lingodesk-footer">
                <span className="footer-glow">LINGODESK PRO • NEURAL LANGUAGE WORKSTATION</span>
            </footer>
        </div>
    );
}

export default App;
