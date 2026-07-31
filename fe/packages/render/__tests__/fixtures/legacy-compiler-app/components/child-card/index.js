Component({
	data: {
		seenPlain: -1,
		seenComputed: -1,
		seenWxsValue: -1,
		seenLoopValue: -1,
		seenIndex: -1
	},
	properties: {
		plain: {
			type: Number,
			observer(value) {
				this.setData({ seenPlain: value })
			}
		},
		computed: {
			type: Number,
			observer(value) {
				this.setData({ seenComputed: value })
			}
		},
		wxsValue: {
			type: Number,
			observer(value) {
				this.setData({ seenWxsValue: value })
			}
		},
		loopValue: {
			type: Number,
			observer(value) {
				this.setData({ seenLoopValue: value })
			}
		},
		index: {
			type: Number,
			observer(value) {
				this.setData({ seenIndex: value })
			}
		}
	}
})
