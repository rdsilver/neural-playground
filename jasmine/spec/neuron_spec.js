describe('Neuron Class Methods', () => {
	beforeEach(() => {
		this.neuron = new Neuron(1, 1, 5, 5);
		this.otherNeuron = new Neuron(2, 2, 5, 5);
	});

	it('should create a neuron with specific attributes', () => {
		expect(this.neuron.xCoord).toEqual(1);
		expect(this.neuron.yCoord).toEqual(1);
		expect(this.neuron.size).toEqual(5);
		expect(this.neuron.activationLevel).toEqual(5);
	});

	it('resets neuron charge when reset method is called', () => {
		this.neuron.curCharge = 10;
		this.neuron.reset();
		expect(this.neuron.curCharge).toEqual(0);
	});

	it('adds charge when addCharge method is called', () => {
		this.neuron.addCharge(1);
		expect(this.neuron.curCharge).toEqual(1);
	});

	it('should set charge to 0 if the charge addeded is larger than its activationLevel', () => {
		this.neuron.addCharge(100);
		expect(this.neuron.curCharge).toEqual(0);
	});

	it('should allow charge to go negative', () => {
		this.neuron.addCharge(-10);
		expect(this.neuron.curCharge).toEqual(-10);
	});

	it('should toggle selected', () => {
		this.neuron.toggleSelected();
		expect(this.neuron.selected).toEqual(true);

		this.neuron.toggleSelected();
		expect(this.neuron.selected).toEqual(false);
	});

	it('adds an inbound connection', () => {
		this.neuron.inBoundConnection(this.otherNeuron);
		expect(this.neuron.inBoundConnections['2 2']).toEqual(this.otherNeuron);
	});
});
