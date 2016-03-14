'use strict';

class Neuron {
	constructor(x, y, neuronSize, actlvl) {
		this.xCoord = x;
		this.yCoord = y;
		this.size = neuronSize;
		this.activationLevel = actlvl;
		this.curCharge = 0;
		this.selected = false;
		this.actionPotentialCharge = 1;

		this.outBoundConnections = {};
		this.inBoundConnections = {};
	}

	display() {
		this.selected ? fill(200, 200, 60) : fill(100, 200, 0);
		stroke(gridColor);
		rect(this.xCoord, this.yCoord, this.size, this.size);
	}

	displayConnections() {
		stroke(200, 0, 100);

		// skew centers the connection to the middle of the neuron
		var skew = this.size/2.0;
		_.each(this.outBoundConnections, outBoundNeuron => {
			line(this.xCoord+skew, this.yCoord+skew, outBoundNeuron.xCoord+skew, outBoundNeuron.yCoord+skew);
		});
	}

	erase() {
		stroke(gridColor);
		fill(bgColor); 
		rect(this.xCoord, this.yCoord, this.size, this.size);
	}

	reset() {
		this.curCharge = 0;
	}

	addCharge(charge) {
		this.curCharge += charge

		if (this.curCharge >= this.activationLevel) {
			this.curCharge = 0;
			this.activate();
		}
	}

	activate() {
		_.each(this.outBoundConnections, otherNeuron => {
			let id = _.uniqueId();
			actionPotentialList[`${id}`] = new ActionPotential(this, otherNeuron, this.size/2, id, this.actionPotentialCharge, this.size);
		}); 
	}

	toggleSelected() {
		this.selected = !this.selected;
	}

	// Toggles an inbound connection between two neurons
	inBoundConnection(otherNeuron) {
		var index = `${otherNeuron.xCoord} ${otherNeuron.yCoord}`;

		if (!this.inBoundConnections[index]) {
			this.inBoundConnections[index] = otherNeuron;
		} else {
			delete this.inBoundConnections[index];
			clearScreen();
		}
	}

	// Toggles an outbound connection between two neurons
	outBoundConnection(otherNeuron) {
		var index = `${otherNeuron.xCoord} ${otherNeuron.yCoord}`;
		
		if (!this.outBoundConnections[index]) {
			this.outBoundConnections[index] = otherNeuron;
		} else {
			delete this.outBoundConnections[index];
			clearScreen();
		}
	}

	// Removes any connections to a neuron that no longer exists
	removeConnection(otherNeuron) {
		var index = `${otherNeuron.xCoord} ${otherNeuron.yCoord}`;
		if (this.inBoundConnections[index]) {
			delete this.inBoundConnections[index];
			clearScreen();
		}

		if (this.outBoundConnections[index]) {
			delete this.outBoundConnections[index];
			clearScreen();
		}
	}

	twoWayConnection(otherNeuron) {
		this.inBoundConnection(otherNeuron);
		this.outBoundConnection(otherNeuron);
	}

	// Overwritten for neurons that need something checked every refresh
	neuronSpecificRoutine() { }

	/*Helper/Util methods*/

	// Slightly faster to get the keys and use a for loop than using _.each (https://jsperf.com/fastest-way-to-iterate-object)
	static displayAllConnections() {
		let keys = _.keys(neuronList);
		for(var i=0; i<keys.length;i++) {
			neuronList[keys[i]].displayConnections();
		}
	}

	static displayAllNeurons() {
		let keys = _.keys(neuronList);
		for(var i=0; i<keys.length;i++) {
			neuronList[keys[i]].display();
		}
	}

	static resetNeurons() {
		let keys = _.keys(neuronList);
		for(var i=0; i<keys.length;i++) {
			neuronList[keys[i]].reset();
		}
	}

	static allNeuronSpecificRoutines() {
		let keys = _.keys(neuronList);
		for(var i=0; i<keys.length;i++) {
			neuronList[keys[i]].neuronSpecificRoutine();
		}
	}

	static deleteNeuron(x, y) {
		neuronList[`${x} ${y}`].erase();
    	_.each(neuronList, neuron => neuron.removeConnection(neuronList[`${x} ${y}`]));
    	delete neuronList[`${x} ${y}`];
	}

	static addConnection(x, y) {
		if(neuronList[`${x} ${y}`] !== selectedNeuron) {
	        if ($( "#connection-placement :checked" ).val() === 'one') {
	          neuronList[`${x} ${y}`].inBoundConnection(selectedNeuron);
	          selectedNeuron.outBoundConnection(neuronList[`${x} ${y}`]);
	        } else {
	          neuronList[`${x} ${y}`].twoWayConnection(selectedNeuron);
	          selectedNeuron.twoWayConnection(neuronList[`${x} ${y}`])
	        }
	    }
    }

    static selectNeuron(x, y) {
    	if (neuronList[`${x} ${y}`]) {
	      selectedNeuron = neuronList[`${x} ${y}`];
	      selectedNeuron.toggleSelected();
    	}
    }

    static unSelectNeuron() {
    	if (selectedNeuron)
    		selectedNeuron.toggleSelected();

    	selectedNeuron = false;
    }

    static createNeuron(x, y) {
	    var activationLevel = parseInt($('#activationLevel').val());
	    var timeInSeconds = parseFloat($('#timerActivationInput').val());
	    var maxSteps = parseFloat(parseInt($('#timesInput').val()));
	    var noteMIDI = parseInt($('#noteInput').val());

	    let tempNeuron = undefined;
	    switch (neuronType) {
	      case 'normal':
	        tempNeuron = new Neuron(x, y, cellSize, activationLevel);
	        break;
	      case 'character':
	        tempNeuron = new CharacterNeuron(x, y, cellSize, activationLevel);
	        break;
	      case 'negative':
	      	tempNeuron = new NegativeNeuron(x, y, cellSize, activationLevel);
	      	break;
	      case 'timer': 
	      	tempNeuron = new TimerNeuron(x, y, cellSize, activationLevel, timeInSeconds, maxSteps);
	      	break;
	      case 'note':
	      	tempNeuron = new NoteNeuron(x, y, cellSize, activationLevel, noteMIDI);
	      	break;

	    }
	    neuronList[`${x} ${y}`] = tempNeuron; 
    }

    static loadExample(exampleName) {
    	var exampleNeuronNet = JSON.parse(exampleNeuronNets[exampleName]);
    	neuronList = {};
		actionPotentialList = {};

		// Adds the neurons to the neuronLists without their connections
		_.each(exampleNeuronNet, neuron => {
			let neuronType = neuron.type;
			let tempNeuron = undefined;

			switch (neuronType) {
		      case 'Neuron':
		        tempNeuron = new Neuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel);
		        break;
		      case 'CharacterNeuron':
		        tempNeuron = new CharacterNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel);
		        break;
		      case 'NegativeNeuron':
		      	tempNeuron = new NegativeNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel);
		      	break;
		      case 'TimerNeuron': 
		      	tempNeuron = new TimerNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel, neuron.timeInSeconds, neuron.maxSteps);
		      	break;
		      case 'NoteNeuron':
		      	tempNeuron = new NoteNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel, neuron.noteMIDI);
		      	break;

		    }

		    neuronList[`${neuron.x} ${neuron.y}`] = tempNeuron;
		});

		// Adds connections
		_.each(exampleNeuronNet, neuron => {
			let tempNeuron = neuronList[`${neuron.x} ${neuron.y}`];

			_.each(neuron.outBounds, outBoundNeuron =>{
				tempNeuron.outBoundConnection(neuronList[outBoundNeuron]);
			});

			_.each(neuron.inBounds, inBoundNeuron =>{
				tempNeuron.inBoundConnection(neuronList[inBoundNeuron]);
			});
		});
    }

    static saveExample() {
    	var neurons = [];

    	_.each(neuronList, neuron => {
    		let neuronType = neuron.constructor.name;
    		let neuronObj = {}

    		neuronObj['type'] = neuronType;
    		neuronObj['x'] = neuron.xCoord;
    		neuronObj['y'] = neuron.yCoord;
    		neuronObj['size'] = neuron.size;
    		neuronObj['activationLevel'] = neuron.activationLevel;
    		neuronObj['outBounds'] = _.keys(neuron.outBoundConnections);
    		neuronObj['inBounds'] = _.keys(neuron.inBoundConnections);

    		switch (neuronType) {
		      case 'TimerNeuron':
		      	neuronObj['timeInSeconds'] = neuron.timeInSeconds;
		      	neuronObj['maxSteps'] = neuron.maxSteps;
		      	break;
		      case 'NoteNeuron':
		      	neuronObj['noteMIDI'] = neuron.note;
		      	break;
	    	}

	    	neurons.push(neuronObj);
    	});

    	return JSON.stringify(neurons);
    }
}