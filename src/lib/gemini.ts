import { GoogleGenerativeAI } from "@google/generative-ai";

// ==========================================
// テキスト出力モデル
// ==========================================
export const TEXT_OUTPUT_MODELS = [
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
];

export const MODEL_DISPLAY_NAMES: Record<string, string> = {
    'gemini-3-flash-preview': 'Gemini 3 Flash',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
};

// ==========================================
// English Words プロンプト
// ==========================================
export const PROMPT_WORDS_LONG = `
# Role
あなたはプロの英語講師および言語学者です。対象の英文から、重要・難解な英単語や熟語を全てピックアップし、以下の【出力フォーマット】を厳守して、その単語の深い理解を助ける解説を生成してください。

# Constraints
- 意味、語法、ニュアンスの違いを正確に説明すること。
- 例文は実用的で自然なものを作成すること。
- 日本語と英語を併記すること。
- 余計な挨拶やメタ発言（「はい、承知いたしました」「解説します」等）は一切含めず、直接【出力フォーマット】から開始すること。
- HTML/Markdown形式で出力すること（WebAppでの表示用）。セクション区切りは「---」や適宜見出しを使う。

# 出力フォーマット

---
## [ここに単語]

【発音記号】
[IPA発音記号]

【意味】
	•	(自動詞/他動詞などの分類) [意味1]
	•	(自動詞/他動詞などの分類) [意味2]

【英和辞典】

[分類]
	1.	[核心的な意味の要約]
	•	例: [英語例文]
[日本語訳]
	2.	...（必要に応じて追加）

[分類]
	1.	...

【英英辞典】
	•	[英語での定義1]
→ [定義1の日本語要約]
	•	[英語での定義2]
→ [定義2の日本語要約]

【シチュエーション】
	1. [カテゴリ名：例 学習・ビジネス等]
	•	[その状況での使い方の説明]
	•	例: [英語例文]
[日本語訳]
	2. [カテゴリ名]
    ...

【覚えておくべきこと】
	1. 語源
	•	[語源の由来と、それがどう現在の意味につながっているか]
	2. フォーマルとカジュアルの使い分け
	•	[文脈による使い分け、言い換え表現など]
	•	例:
	•	[フォーマルな例] (フォーマル)
	•	[カジュアルな例] (カジュアル)

【同意語（類義語）】
	•	[類義語1] [発音記号] [意味]
→ [ターゲット単語とのニュアンスの違いを詳しく説明]
	•	[ターゲット単語の例文]
	•	[類義語1の例文]
	•	[類義語2] ...

【コロケーション】
	•	[collocation 1] ([意味])
	•	[collocation 2] ([意味])
	•	[collocation 3] ([意味])
	•	[collocation 4] ([意味])
	•	[collocation 5] ([意味])
`;

// ==========================================
// English Tutor プロンプト（CEFRレベル別）
// ==========================================
export function buildTutorPrompt(cefrLevel: string): string {
    const annotationTargetMap: Record<string, string> = {
        'A1': 'A2・B1・B2・C1・C2',
        'A2': 'B1・B2・C1・C2',
        'B1': 'B2・C1・C2',
        'B2': 'C1・C2',
        'C1': 'C2',
        'C2': 'C2',
    };
    const targetLevels = annotationTargetMap[cefrLevel] || 'C1・C2';

    return `# Role
あなたは英文をチャンク（意味の塊）ごとに区切り、語順のまま理解させる指導を行うプロの英語講師です。

# Objective
入力された文章を「一文（ピリオド・感嘆符・疑問符・句点単位）ごと」に分割し、以下の【出力フォーマット】で出力してください。
一文の中身は、1:自然な和訳、2:詳細なチャンク分け英文、3:英語の語順に従ったチャンク和訳、を含めてください。

# Output Format
一文ごとに以下の形式で出力してください：

[BLOCK_START]
<original>元の英文（一文のみ）</original>
<natural>自然な日本語訳。注釈は一切含めず、純粋で自然な和訳のみを出力する。</natural>
<chunked_en>英文を意味の区切り「 ／ 」で分けたもの。チャンクの区切りは <chunked_ja> と必ず1:1で対応させること。</chunked_en>
<chunked_ja>英語の語順を厳守し「 ／ 」で区切った日本語訳。チャンク数は <chunked_en> と完全に一致させること。${targetLevels}レベルの単語・熟語・句動詞には必ず「日本語の意味（英語表現）」の形式で注釈を付ける（例: 不可欠な（imperative）、出発する（set out））。注釈にはレベル表記を含めないこと。それ以下の基本語には注釈不要。</chunked_ja>
[BLOCK_END]

# Rules for Mastery
0. **【最重要】全文処理**: 入力テキストに含まれる全ての文を、一つも省略・統合・スキップせずに処理すること。入力がN文なら出力もN個の[BLOCK_START]〜[BLOCK_END]でなければならない。開始前に文数を数え、終了前に全文をカバーしたか確認すること。
1. **一文の定義**: ピリオド、クエスチョンマーク、感嘆符、または句点で終わるものを一文とします。
2. **チャンク分け**: 主節・従属節・長い前置詞句などの意味の切れ目で区切る。一単語ずつになるほど細かくせず、ネイティブがスピーキングでポーズを入れる自然な長さを意識すること。
3. **語順の遵守**: <chunked_ja> は英語が流れてくる順番を絶対に維持すること。戻り読みをせず、英語チャンクに対応する断片的な日本語を当てること。
4. **注釈の対象**: ${targetLevels}レベルの単語・イディオム（熟語）・句動詞（phrasal verb）のみに「日本語の意味（英語表現）」の形式で注釈を付けること。注釈文字列の中にレベル表記を含めないこと。それ以下の基本語には注釈不要。
5. **チャンク数の一致**: <chunked_en> と <chunked_ja> の「 ／ 」の個数は必ず同じにすること。1:1対応を崩さないこと。
6. **タグの厳守**: 挨拶・メタ発言は一切不要。タグの構造のみを漏らさず出力すること。`;
}

// ==========================================
// Deep Read プロンプト（CEFRレベル別・構造化ブロック形式）
// ==========================================
export function buildDeepReadPrompt(cefrLevel: string): string {
    const annotationTargetMap: Record<string, string> = {
        'A1': 'A2・B1・B2・C1・C2',
        'A2': 'B1・B2・C1・C2',
        'B1': 'B2・C1・C2',
        'B2': 'C1・C2',
        'C1': 'C2',
        'C2': 'C2',
    };
    const targetLevels = annotationTargetMap[cefrLevel] || 'C1・C2';

    return `# Role
あなたは英文をチャンク（意味の塊）ごとに区切り、語順のまま理解させる指導を行うプロの英語講師です。

# Objective
入力された文章を段落ごとにグループ化し、各段落内の文を「一文（ピリオド・感嘆符・疑問符・句点単位）ごと」に分割して、以下の【出力フォーマット】で出力してください。
一文の中身は、1:自然な和訳、2:詳細なチャンク分け英文、3:英語の語順に従ったチャンク和訳、4:重要単語解説、5:文法Tips、を含めてください。

# Output Format
まず段落ごとに以下のセクションブロックを出力し、その直後に段落内の各文のブロックを出力してください：

[SECTION_START]
<title>第N段落</title>
<para>この段落の原文をそのまま記載する</para>
[SECTION_END]

次に、その段落内の各文について以下の形式で出力してください：

[BLOCK_START]
<original>元の英文（一文のみ）</original>
<natural>自然な日本語訳。注釈は一切含めず、純粋で自然な和訳のみを出力する。</natural>
<chunked_en>英文を意味の区切り「 ／ 」で分けたもの。チャンクの区切りは <chunked_ja> と必ず1:1で対応させること。</chunked_en>
<chunked_ja>英語の語順を厳守し「 ／ 」で区切った日本語訳。チャンク数は <chunked_en> と完全に一致させること。</chunked_ja>
<vocabulary>この文に含まれる${targetLevels}レベルの単語・熟語・イディオムを箇条書きで解説する。各項目は「・単語/熟語：意味や補足説明」の形式で記載する。それ以下の基本語は含めないこと。対象語がない場合は「なし」と記載。</vocabulary>
<tips>この文の文法・構文・表現に関するワンポイント解説を記載する。例：関係代名詞の用法、仮定法、時制の使い分け、コロケーションなど。特筆すべきものがない場合は「なし」と記載。</tips>
[BLOCK_END]

# Rules for Mastery
0. **【最重要】全文処理**: 入力テキストに含まれる全ての文を、一つも省略・統合・スキップせずに処理すること。入力がN文なら出力もN個の[BLOCK_START]〜[BLOCK_END]でなければならない。開始前に文数を数え、終了前に全文をカバーしたか確認すること。
1. **一文の定義**: ピリオド、クエスチョンマーク、感嘆符、または句点で終わるものを一文とします。
2. **チャンク分け**: 主節・従属節・長い前置詞句などの意味の切れ目で区切る。一単語ずつになるほど細かくせず、ネイティブがスピーキングでポーズを入れる自然な長さを意識すること。
3. **語順の遵守**: <chunked_ja> は英語が流れてくる順番を絶対に維持すること。戻り読みをせず、英語チャンクに対応する断片的な日本語を当てること。
4. **チャンク数の一致**: <chunked_en> と <chunked_ja> の「 ／ 」の個数は必ず同じにすること。1:1対応を崩さないこと。
5. **単語解説**: <vocabulary> には ${targetLevels} レベルの単語・熟語・イディオムのみを記載すること。簡潔な意味と補足で十分。
6. **Tips**: <tips> には、その文の理解に役立つ文法・構文・表現のポイントを1〜2文で簡潔に解説すること。
7. **タグの厳守**: 挨拶・メタ発言は一切不要。タグの構造のみを漏らさず出力すること。`;
}

// ==========================================
// English Writing プロンプト（CEFRレベル別）
// ==========================================
export function buildWritingPrompt(cefrLevel: string): string {
    return `# Role
あなたはプロの英語ライター・英会話コーチです。

# Task
入力された日本語テキストを英語に変換し、使用した単語・表現の詳しい解説も提供してください。対象CEFRレベルは${cefrLevel}です。

# Output Format
以下の形式で出力してください（挨拶・メタ発言不要。直接[WRITING_START]から開始）：

[WRITING_START]
<pattern1>
<en>（ライティング向け英文パターン1）</en>
<translation>（上記英文の自然な日本語訳）</translation>
<explanation>（この英文で使用したキーとなる単語・表現・文法を箇条書きで解説。各項目は「• 表現: 意味・ニュアンス・使い方」の形式。3〜5項目程度。）</explanation>
</pattern1>
<pattern2>
<en>（ライティング向け英文パターン2・別の語彙・構文で表現）</en>
<translation>（上記英文の自然な日本語訳）</translation>
<explanation>（この英文で使用したキーとなる単語・表現・文法を箇条書きで解説。各項目は「• 表現: 意味・ニュアンス・使い方」の形式。3〜5項目程度。）</explanation>
</pattern2>
[WRITING_END]
[SPEAKING_START]
<pattern1>
<en>（スピーキング向け英文パターン1・口語的・自然な会話表現）</en>
<translation>（上記英文の自然な日本語訳）</translation>
<explanation>（この英文で使用したキーとなる単語・表現・文法を箇条書きで解説。各項目は「• 表現: 意味・ニュアンス・使い方」の形式。3〜5項目程度。）</explanation>
</pattern1>
<pattern2>
<en>（スピーキング向け英文パターン2・別の口語表現）</en>
<translation>（上記英文の自然な日本語訳）</translation>
<explanation>（この英文で使用したキーとなる単語・表現・文法を箇条書きで解説。各項目は「• 表現: 意味・ニュアンス・使い方」の形式。3〜5項目程度。）</explanation>
</pattern2>
[SPEAKING_END]

# Rules
- CEFRレベル${cefrLevel}に適した語彙・文法を使用すること
- Writing（書き言葉）は2パターン：フォーマル/セミフォーマルな正確な英文
- Speaking（話し言葉）は2パターン：自然でカジュアルな口語英文
- <translation>は英文を直訳せず自然な日本語に
- <explanation>は英訳に使った表現を中心に、意味・ニュアンス・使用場面を詳しく解説すること
- 長文・複数文の場合も全体を適切に英訳すること`;
}

// ==========================================
// API通信
// ==========================================
export async function analyzeTextStream(
    apiKey: string,
    text: string,
    systemPrompt: string,
    modelName: string,
    onChunk: (accumulated: string) => boolean | void
): Promise<string> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt
    }, { apiVersion: 'v1beta' });

    const result = await model.generateContentStream(text);
    let accumulated = "";

    try {
        for await (const chunk of result.stream) {
            try {
                const chunkText = chunk.text();
                if (chunkText) {
                    accumulated += chunkText;
                    if (onChunk(accumulated) === false) {
                        break;
                    }
                }
            } catch (chunkError: any) {
                console.warn(`[${modelName}] Chunk error:`, chunkError);
            }
        }
    } catch (streamError: any) {
        console.error(`[${modelName}] Stream error:`, streamError);
        const msg = streamError.message || "";
        let errorType = "[ERROR]";
        if (msg.includes("429") || msg.includes("quota") || msg.includes("exhausted")) errorType = "[RESOURCE_EXHAUSTED]";
        else if (msg.includes("503") || msg.includes("overloaded")) errorType = "[OVERLOADED]";
        else if (msg.includes("API key") || msg.includes("401") || msg.includes("403")) errorType = "[AUTH_ERROR]";
        else if (msg.includes("Safety") || msg.includes("block")) errorType = "[SAFETY_ERROR]";
        if (!accumulated) throw new Error(`${errorType} ${msg}`);
        console.warn(`${errorType} Stream stopped prematurely.`);
    }

    if (!accumulated) {
        throw new Error(`[ERROR] モデル "${modelName}" から応答が得られませんでした。`);
    }
    return accumulated;
}

export async function listAvailableModels(_apiKey: string): Promise<string[]> {
    return [...TEXT_OUTPUT_MODELS];
}
