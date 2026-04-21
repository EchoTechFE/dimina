type DiminaRecord = Record<string, any>

interface DiminaDataContext<TData extends DiminaRecord = DiminaRecord> {
	data: TData
	setData(data: Partial<TData> & DiminaRecord): void
}

declare const wx: any

declare function getApp<T = any>(): T
declare function getCurrentPages(): any[]

declare function App<TOptions extends DiminaRecord = DiminaRecord>(
	options: TOptions & ThisType<TOptions>,
): void

declare function Page<TData extends DiminaRecord = DiminaRecord, TCustom extends DiminaRecord = DiminaRecord>(
	options: TCustom & {
		data?: TData
	} & ThisType<DiminaDataContext<TData> & TCustom>,
): void

declare function Behavior<TOptions extends DiminaRecord = DiminaRecord>(
	options: TOptions,
): TOptions

declare function Component<
	TData extends DiminaRecord = DiminaRecord,
	TProperties extends DiminaRecord = DiminaRecord,
	TMethods extends DiminaRecord = DiminaRecord,
>(
	options: {
		data?: TData
		properties?: TProperties
		methods?: TMethods & ThisType<DiminaDataContext<TData> & { properties: TProperties } & TMethods>
	} & ThisType<DiminaDataContext<TData> & { properties: TProperties } & TMethods>,
): void
