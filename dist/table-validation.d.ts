/*!
 * table-validation v1.2.0 — hand-authored TypeScript declarations for the Browser JS
 * profile (Core Specification v1.2.0 + Authoring, Ingestion & Inference Addendum v1.2.0).
 * The runtime is a single IIFE exposing one global, `TableValidation`; these
 * declarations describe that global. No build step — this file is authored by hand,
 * kept in lockstep with dist/table-validation.js, and served from the same CDN tag.
 */

declare namespace TableValidation {
    // ================================================================
    // Input model (Core §1.5)
    // ================================================================

    /** A table cell: one of the JSON scalar kinds. Non-scalars are typeMismatch at run time. */
    type Cell = string | number | boolean | null;

    interface TableInput {
        /** null → headerless table (byPosition matching territory). */
        headers: string[] | null;
        rows: Cell[][];
    }

    // ================================================================
    // Shared primitives (Core §3)
    // ================================================================

    interface Range {
        min: number | string | null;
        max: number | string | null;
        minInclusive: boolean;
        maxInclusive: boolean;
    }

    interface StringMatchStrategy {
        caseSensitive: boolean;
        trim: boolean;
        stripSpaces: boolean;
    }

    interface NumberFormat {
        decimalSeparator: string | null;
        groupingSeparators: string[];
        /** §3.5 (1.2.0): accept bare decimals — ".85" reads as 0.85. Default false; requires a non-null decimalSeparator. */
        allowBareDecimal?: boolean;
    }

    type SeverityLevel = 'error' | 'warning';
    /** Per-rule severity (Core §5.6): plain level, or per-rule map. */
    type Severity = SeverityLevel | { default?: SeverityLevel; byRule?: { [ruleName: string]: SeverityLevel } };

    // ================================================================
    // Schema (Core §4–§7, §15.3)
    // ================================================================

    type TypeName = 'string' | 'int' | 'float' | 'bool' | 'datetime' | 'date' | 'time' | 'categorical' | 'skip';

    interface TypeBlock {
        name: TypeName;
        /** string */
        length?: Range | null;
        regex?: string | null;
        regexFlags?: string | null;
        /** int / float: NumberFormat[]; datetime / date / time: format strings */
        formats?: NumberFormat[] | string[] | null;
        value?: Range | null;
        /** float */
        precision?: Range | null;
        /** bool */
        trueValues?: string[];
        falseValues?: string[];
        /** bool / categorical */
        matchStrategy?: StringMatchStrategy;
        /** categorical */
        allowedValues?: Array<string | number | boolean>;
        typeStrict?: boolean;
    }

    interface ColumnDef {
        required?: boolean | null;
        nullable?: boolean;
        severity?: Severity;
        stopOnFail?: boolean;
        unique?: { enabled?: boolean; nullsEqual?: boolean };
        nullHandling?: { nullEquivalents?: string[] | null };
        evaluation?: { strictType?: boolean | null };
        type: TypeBlock;
    }

    interface CompositeKey {
        columns: string[];
        nullsAllowed?: boolean;
        severity?: SeverityLevel;
    }

    type ComparisonOp = '<' | '<=' | '==' | '!=' | '>=' | '>';

    interface RowCheck {
        name: string;
        type: 'comparison' | 'conditionalRequired' | 'nonNullCount' | 'cooccurrence' | 'custom';
        severity?: SeverityLevel;
        fieldA?: string;
        fieldB?: string;
        op?: ComparisonOp;
        if?: { field: string; op: ComparisonOp; value: unknown };
        then?: { field: string; nonNull: true };
        fields?: string[];
        expected?: number;
        fn?: string;
        params?: object | null;
    }

    interface TableCheck {
        name: string;
        type: 'monotonic' | 'sequenceNoGaps' | 'sumEquals' | 'custom';
        severity?: SeverityLevel;
        field?: string;
        direction?: 'increasing' | 'decreasing' | 'nonDecreasing' | 'nonIncreasing';
        start?: number | null;
        fields?: string[];
        expectedValue?: number | null;
        expectedField?: string | null;
        expectedFieldRow?: 'first' | 'last' | number;
        tolerance?: number;
        fn?: string;
        params?: object | null;
    }

    /** Numeric tolerance (Core §15.8): absolute, per-row driver, relative, or custom fn. */
    type ToleranceSpec =
        | number
        | { field: string; from?: 'expected' | 'produced' }
        | { percent: number; of: string; from?: 'expected' | 'produced' }
        | { fn: string; params?: object | null };

    interface FuzzyKeySpec {
        components: string[];
        threshold: number | { [component: string]: number };
        metric?: 'tokenizedFuzzy' | 'jaroWinkler' | 'levenshtein';
        ambiguityMargin?: number;
        maxCandidatePairs?: number;
    }

    interface CellFuzzySpec {
        threshold: number;
        metric?: 'tokenizedFuzzy' | 'jaroWinkler' | 'levenshtein';
    }

    type ComparisonTierSeverity = 'none' | 'warning' | 'error';

    interface ComparisonSection {
        match: {
            keys: string[];
            setMode?: 'exact' | 'superset' | 'subset';
            /** Core §15.6: duplicated interpreted key → abort (default) or report + exclude. */
            onDuplicateKey?: 'abort' | 'reportAndExclude';
            fuzzy?: FuzzyKeySpec | null;
        };
        fields?: {
            [column: string]: {
                compare?: boolean;
                presence?: 'both' | 'producedOnly' | 'expectedOnly';
                /** Header the EXPECTED table carries this column under (Core §15.6). */
                expectedName?: string | null;
                tolerance?: ToleranceSpec | null;
                fuzzy?: CellFuzzySpec | null;
            };
        };
        severity?: {
            toleranceMatch?: ComparisonTierSeverity;
            interpretedMatch?: ComparisonTierSeverity;
            fuzzyMatch?: ComparisonTierSeverity;
            crossTypeMismatch?: ComparisonTierSeverity;
            valueMismatch?: ComparisonTierSeverity;
            fuzzyKeyMatch?: ComparisonTierSeverity;
            ambiguousFuzzyMatch?: ComparisonTierSeverity;
            rowMissing?: ComparisonTierSeverity;
            rowUnexpected?: ComparisonTierSeverity;
            columnOnlyOnOneSide?: ComparisonTierSeverity;
            /** Effective only under onDuplicateKey: "reportAndExclude". */
            duplicateMatchKey?: ComparisonTierSeverity;
        };
        scope?: {
            column: string;
            inScopeValues?: Array<string | number | boolean>;
            outOfScopeValues?: Array<string | number | boolean>;
            matchStrategy?: StringMatchStrategy;
            outOfScopePolicy?: 'compare' | 'skip';
        } | null;
        diffChecks?: {
            row?: DiffCheckDef[];
            table?: DiffCheckDef[];
        };
    }

    interface DiffCheckDef {
        name: string;
        type: 'custom' | 'orphanRateMax' | 'mismatchRateMax';
        severity?: ComparisonTierSeverity;
        fn?: string | null;
        params?: object | null;
    }

    /** The one config artifact both engines consume (Core §4). */
    interface Schema {
        meta: { schemaVersion: string; name: string; description?: string };
        resultConfig?: {
            maxSamples?: number;
            maxErrors?: number | null;
            maxErrorsPerColumn?: number | null;
            collectCellRegister?: boolean;
            collectCellObservations?: boolean;
            stopPolicy?: 'never' | 'firstError';
        };
        nullHandling?: { nullEquivalents?: string[] };
        evaluation?: { strictType?: boolean; timezone?: string };
        structure?: {
            columnMatching?: 'byName' | 'byPosition';
            fieldNameMatching?: StringMatchStrategy;
            rowCount?: Range;
            columnCount?: Range;
            allowDuplicateRows?: boolean;
            allowAllNullRows?: boolean;
            allowDuplicateColumns?: boolean;
            allowAllNullColumns?: boolean;
            duplicateColumnNames?: { strategy?: 'rename' | 'halt' | 'keepFirst'; renamePattern?: string };
            allowExtraColumns?: boolean;
            allowMissingColumns?: boolean;
            enforceColumnOrder?: boolean;
            duplicateDetection?: { matchStrategy?: StringMatchStrategy };
            severities?: { [structuralRule: string]: SeverityLevel };
        };
        columns: { [name: string]: ColumnDef };
        compositeKeys?: CompositeKey[];
        customRowChecks?: RowCheck[];
        customTableChecks?: TableCheck[];
        comparison?: ComparisonSection;
    }

    // ================================================================
    // Results (Core §9, §15.10)
    // ================================================================

    interface SummaryDetail {
        severity: SeverityLevel;
        phase: string;
        ruleName: string;
        fieldName: string | null;
        message: string;
        context: { [key: string]: unknown };
        count: number;
        firstOccurrenceRow: number | null;
        topSampleValues: Array<{ value: string; frequency: number }>;
        topSampleRows: number[];
    }

    interface RegisterEntry {
        row: number | null;
        field: string | null;
        severity: SeverityLevel;
        ruleName: string;
        value: Cell;
        message: string;
        context: { [key: string]: unknown };
    }

    type ObservationOutcome = 'native' | 'interpreted' | 'effectivelyNull' | 'violation' | 'skipped' | 'notChecked';

    interface CellObservation {
        row: number;
        field: string;
        rawValue: Cell;
        interpretedValue: unknown;
        outcome: ObservationOutcome;
        worstSeverity: SeverityLevel | null;
    }

    interface ResultBase {
        specVersion: string;
        valid: boolean;
        validWithWarnings: boolean;
        aborted: boolean;
        abortReason: string | null;
        truncated: boolean;
        truncationReason: 'maxErrors' | 'maxErrorsPerColumn' | null;
        summary: {
            rowsChecked: number;
            columnsChecked: number;
            bySeverity: { error: number; warning: number };
            byPhase: { [phase: string]: number };
            byColumn: { [column: string]: { error: number; warning: number } };
            truncatedColumns: string[];
            details: SummaryDetail[];
            [extra: string]: unknown;
        };
        cellRegister: RegisterEntry[] | null;
    }

    interface ValidationResult extends ResultBase {
        summary: ResultBase['summary'] & { columnMatching: 'byName' | 'byPosition' };
        cellObservations: CellObservation[] | null;
    }

    type RowDiffStatus = 'matched' | 'fuzzyMatched' | 'missing' | 'unexpected' | 'excludedDuplicateKey';

    interface CellDiff {
        rollup: 'equal' | 'equivalent' | 'different';
        tier: 'exact' | 'interpretedMatch' | 'toleranceMatch' | 'fuzzyMatch' | 'crossTypeMismatch' | 'valueMismatch';
        produced: Cell;
        expected: Cell;
        producedInterpreted: unknown;
        expectedInterpreted: unknown;
        delta: number | null;
        tolerance: number | null;
        similarity: number | null;
    }

    interface RowDiff {
        matchKey: unknown[];
        status: RowDiffStatus;
        inScope: boolean;
        similarity: number | null;
        producedRow: number | null;
        expectedRow: number | null;
        cells: { [column: string]: CellDiff };
        checkFails: Array<{ name: string; field: string | null; message: string | null }>;
    }

    interface ComparisonResult extends ResultBase {
        engine: 'compare';
        summary: ResultBase['summary'] & {
            rowsProduced: number;
            rowsExpected: number;
            rowsMatched: number;
            rowsMissing: number;
            rowsUnexpected: number;
            /** Rows excluded by onDuplicateKey: "reportAndExclude" (Core §15.6); 0 otherwise. */
            rowsExcluded: number;
        };
        diff: {
            rows: RowDiff[];
            tableCheckFails: Array<{ name: string; matchKey: unknown; field: string | null; message: string | null }>;
            summary: {
                comparedCells: number;
                differentCells: number;
                equivalentCells: number;
                orphanRateExpected: number;
                orphanRateProduced: number;
            };
        };
    }

    interface Report {
        verdict: 'pass' | 'passWithWarnings' | 'fail' | 'aborted';
        needsAttention: boolean;
        rowsChecked: number;
        columnsChecked: number;
        bySeverity: { error: number; warning: number };
        checksFailed: number;
        columnsAffected: number;
        topIssues: Array<{ severity: SeverityLevel; ruleName: string; fieldName: string | null; count: number; message: string }>;
        aborted: boolean;
        abortReason: string | null;
        truncated: boolean;
        truncationReason: string | null;
    }

    // ================================================================
    // Engine options & custom-check contracts (JS profile §3.2/§3.3, §4.3)
    // ================================================================

    type RowCheckFn = (
        row: { [column: string]: Cell },
        interpreted: { [column: string]: unknown },
        rowIndex: number,
        params: object | null,
    ) => Array<{ field: string; pass: boolean; message?: string | null }>;

    type TableCheckFn = (
        rows: Array<{ [column: string]: Cell }>,
        interpreted: Array<{ [column: string]: unknown }>,
        params: object | null,
    ) => Array<{ row: number; field: string; pass: boolean; message?: string | null }>;

    type RowDiffCheckFn = (rowDiff: RowDiff, params: object | null) =>
        Array<{ field: string; pass: boolean; message?: string | null }>;

    type TableDiffCheckFn = (diff: { rows: RowDiff[]; summary: object }, params: object | null) =>
        Array<{ row?: number | null; field?: string | null; pass: boolean; message?: string | null }>;

    type ToleranceFn = (cellPair: object, rowDiff: RowDiff, params: object | null) => number;

    type HostFunction = RowCheckFn | TableCheckFn | RowDiffCheckFn | TableDiffCheckFn | ToleranceFn;

    type MessageTemplates = { [ruleName: string]: string | ((context: object) => string) };

    interface EngineOptions {
        functions?: { [name: string]: HostFunction };
        referenceInstant?: Date | string | null;
        messageTemplates?: MessageTemplates;
    }

    // ================================================================
    // Authoring module (Addendum §A, JS profile §3.11)
    // ================================================================

    type Predicate =
        | { path: string; op: 'eq' | 'neq' | 'in' | 'notIn'; value: unknown }
        | { path: string; op: 'null' | 'nonNull' }
        | { all: Predicate[] }
        | { any: Predicate[] }
        | { not: Predicate };

    interface Dependency {
        kind: 'requires' | 'exactlyOneOf' | 'requiredWith';
        predicate: Predicate | null;
        group: string[] | null;
    }

    interface SettingDescriptor {
        path: string;
        section: string;
        type: string;
        required: boolean;
        default?: unknown;
        enum: unknown[] | null;
        engines: Array<'validate' | 'compare'>;
        dependsOn: Dependency[];
        relevantWhen: Predicate | null;
        metaRules: string[];
        doc: { label: string; description: string };
    }

    interface ConfigModel {
        specVersion: string;
        settings: readonly SettingDescriptor[];
        crossRules: ReadonlyArray<{ rule: string; doc: string }>;
    }

    interface AuthoringValidationResult {
        valid: boolean;
        /** Exhaustive: one entry per independent Phase-1 defect (Addendum §A.4 req. 7). */
        errors: Array<{ path: string; expected: string; actual: unknown }>;
        advisories: Array<{ setting: string; reason: string }>;
        deferred: string[];
    }

    interface ConfigBuilder {
        set(path: string, value: unknown): ConfigBuilder;
        get(path: string): unknown;
        unset(path: string): ConfigBuilder;
        addColumn(name: string, definition?: Partial<ColumnDef>): ConfigBuilder;
        removeColumn(name: string): ConfigBuilder;
        moveColumn(name: string, toIndex: number): ConfigBuilder;
        addCompositeKey(def: CompositeKey): ConfigBuilder;
        addRowCheck(def: RowCheck): ConfigBuilder;
        addTableCheck(def: TableCheck): ConfigBuilder;
        setComparison(def: ComparisonSection | null): ConfigBuilder;
        validate(options?: {
            functions?: { [name: string]: HostFunction };
            intendedUse?: 'validate' | 'compare' | 'both';
        }): AuthoringValidationResult;
        /** The AUTHORED (sparse) config — defaults never baked in (Addendum §A.5). */
        build(): Schema;
        /** Fully resolved view (defaults + overrides applied) — inspection only. */
        resolvedPreview(): Schema;
    }

    // ================================================================
    // Ingestion module (Addendum §B, JS profile §3.12)
    // ================================================================

    interface NormalizationStep {
        fn: string;
        params?: object | null;
    }

    interface NormalizationSpec {
        table?: NormalizationStep[];
        columns?: { [headerNameOrPosition: string]: NormalizationStep[] };
    }

    interface IngestSpec {
        format: 'csv' | 'tsv' | 'xlsx' | 'jsonArrays' | 'jsonObjects';
        header?: { mode?: 'firstRow' | 'none' | 'explicit'; names?: string[] | null };
        csv?: { delimiter?: string; quote?: string; encoding?: string };
        xlsx?: { sheet?: string | number };
        /** Drop N leading parsed rows before header handling (Addendum §B.4). */
        skipRows?: number;
        /** Drop N trailing data rows after header handling (Addendum §B.4). */
        skipFooterRows?: number;
        limits?: {
            maxRows?: number | null;
            maxColumns?: number | null;
            maxCells?: number | null;
            maxBytes?: number | null;
        };
        /** Opt-in normalization pipeline (Addendum §B.8). */
        normalization?: NormalizationSpec | null;
    }

    interface SourceProvenance {
        format: string;
        encodingUsed: string | null;
        delimiter: string | null;
        sheetName: string | null;
        rowCount: number;
        columnCount: number;
        headerMode: 'firstRow' | 'none' | 'explicit' | 'intrinsic';
        skippedRows: number;
        skippedFooterRows: number;
    }

    interface IngestWarning {
        code: 'mergedCell' | 'formulaNoCachedResult' | 'errorCell' | 'encodingFallback' | 'irrelevantIngestSetting';
        message: string;
        row: number | null;
        column: number | null;
        count: number;
    }

    interface IngestResult {
        table: TableInput;
        source: SourceProvenance;
        warnings: IngestWarning[];
        /** Present iff a §B.8 normalization pipeline ran. */
        normalizationActions?: Array<{ column: string | number; fn: string; count: number }>;
    }

    /** Normalization host function (Addendum §B.8): pure, total, scalar-returning. */
    type NormalizationFn = (
        cell: Cell,
        coordinates: { row: number; column: number; columnName: string | null },
        params: object | null,
    ) => Cell;

    interface IngestOptions {
        normalizationFunctions?: { [name: string]: NormalizationFn };
    }

    type IngestSource = string | ArrayBuffer | Uint8Array | Blob | unknown[];

    /** Registry descriptor for the §B.8 built-ins (drives the console's step editor). */
    interface NormalizationModelEntry {
        fn: string;
        perColumnOnly: boolean;
        doc: string;
        params: ReadonlyArray<{ name: string; type: string; required: boolean; default?: unknown; enum?: readonly string[] }>;
    }

    // ================================================================
    // Inference module (Addendum §C, JS profile §3.13)
    // ================================================================

    interface InferenceOptions {
        sampleRows?: number;
        name?: string;
        suggestRanges?: boolean;
        /** §C.7 (1.1.0): draft observed decimal-precision bounds on float columns. Default TRUE. */
        suggestPrecision?: boolean;
        seedComparison?: boolean;
        /** §C.4 step 5: draft every accepting temporal candidate; union coverage for mixed columns. */
        allAcceptingFormats?: boolean;
        /** §C.2 (1.2.0): the sample is the whole table; acceptance over unique values. Default false. */
        exhaustive?: boolean;
    }

    interface InferenceReportColumn {
        name: string;
        inferredType: string;
        confidence: 'high' | 'ambiguous' | 'fallback';
        reasons: string[];
        alternatives: Array<{ type: string; formats: string[] | null; rank: number }>;
        observed: {
            participants: number;
            nulls: number;
            distinctCount: number;
            nullTokensSeen: { [token: string]: number };
            min: unknown;
            max: unknown;
            minPrecision: number | null;
            maxPrecision: number | null;
            reliedOnInterpretation: boolean;
        };
        candidateKey: boolean;
        sampleDerivedNullability: boolean;
    }

    interface InferenceReport {
        sample: { rowsAvailable: number; rowsSampled: number; exhaustive: boolean };
        columns: InferenceReportColumn[];
        candidateKeys: string[];
        noSingleColumnKey: boolean;
        suggestions: { tolerances: Array<{ column: string; suggested: number; basis: string }> };
        limitations: string[];
    }

    interface InferenceResult {
        draft: Schema;
        report: InferenceReport;
    }

    // ================================================================
    // Public API (JS profile §3)
    // ================================================================

    /** Unified release version — equals SPEC_VERSION ("1.0.0"). */
    const VERSION: string;
    /** Implemented Core Spec version; stamped as result.specVersion. */
    const SPEC_VERSION: string;

    /** Caller-error exception: bad arguments or a missing dependency global. */
    class TableValidationConfigError extends Error {
        name: 'TableValidationConfigError';
    }

    /** Fatal ingestion condition (Addendum §B.7); carries the canonical code. */
    class TableValidationIngestError extends Error {
        name: 'TableValidationIngestError';
        code: string;
        detail: unknown;
    }

    /** The validation engine (Core §8). Synchronous, pure, never mutates inputs. */
    function validate(schema: Schema, table: TableInput, options?: EngineOptions): ValidationResult;

    /** The comparison engine (Core §15). Synchronous, pure, never mutates inputs. */
    function compare(schema: Schema, produced: TableInput, expected: TableInput, options?: EngineOptions): ComparisonResult;

    /** Pure derivation of the Core §9.3 report from either engine's result. */
    function buildReport(result: ValidationResult | ComparisonResult): Report;

    /** Render a (ruleName, context) pair to a human message (localizable seam, Core §14.1). */
    function renderMessage(ruleName: string, context: object, templates?: MessageTemplates): string;

    /** Core §9.4 three-sheet workbook. Requires the ExcelJS global and cellRegister. */
    function exportXlsx(args: {
        result: ValidationResult; table: TableInput; schema: Schema; messageTemplates?: MessageTemplates;
    }): Promise<Blob>;

    /** Core §15.11 comparison workbook. Requires ExcelJS, result.diff, and cellRegister. */
    function exportComparisonXlsx(args: {
        result: ComparisonResult; table: TableInput; schema: Schema; expected: TableInput; messageTemplates?: MessageTemplates;
    }): Promise<Blob>;

    /** Annotated workbook (Core §9.5 palette). Requires ExcelJS and cellObservations. */
    function exportAnnotatedXlsx(args: {
        result: ValidationResult; table: TableInput; schema: Schema; messageTemplates?: MessageTemplates;
    }): Promise<Blob>;

    /** Zero-dependency TableInput conveniences (JS profile §3.9). */
    namespace adapters {
        function fromArrays(data: unknown[][], options?: { hasHeaderRow?: boolean }): TableInput;
        function fromObjects(records: object[]): TableInput;
    }

    /** The Addendum §A.1 ConfigModel descriptor — deeply frozen plain data. */
    const configModel: ConfigModel;

    /** Create a config builder (Addendum §A.4). Seed is deep-copied, never mutated. */
    function createConfigBuilder(seed?: Schema | object): ConfigBuilder;

    /** The ingestion engine (Addendum §B): source → TableInput + provenance + warnings. */
    function ingest(source: IngestSource, ingestSpec: IngestSpec, options?: IngestOptions): Promise<IngestResult>;

    /** The §B.8 normalization registry descriptor — deeply frozen plain data. */
    const normalizationModel: readonly NormalizationModelEntry[];

    /** Config inference (Addendum §C): TableInput → draft schema + evidence report. */
    function inferConfig(table: TableInput, options?: InferenceOptions): InferenceResult;
}
