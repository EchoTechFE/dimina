Page({
	data: {
		count: 2,
		offset: 3,
		items: [
			{ value: 7 },
			{ value: 11 }
		]
	},
	updateValues() {
		this.setData({
			count: 4,
			offset: 6,
			items: [
				{ value: 13 },
				{ value: 17 }
			]
		})
	}
})
