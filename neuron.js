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
			clearGrid(true);
		}
	}

	// Toggles an outbound connection between two neurons
	outBoundConnection(otherNeuron) {
		var index = `${otherNeuron.xCoord} ${otherNeuron.yCoord}`;
		
		if (!this.outBoundConnections[index]) {
			this.outBoundConnections[index] = otherNeuron;
		} else {
			delete this.outBoundConnections[index];
			clearGrid(true);
		}
	}

	// Removes any connections to a neuron that no longer exists
	removeConnection(otherNeuron) {
		var index = `${otherNeuron.xCoord} ${otherNeuron.yCoord}`;
		if (this.inBoundConnections[index]) {
			delete this.inBoundConnections[index];
			clearGrid(true);
		}

		if (this.outBoundConnections[index]) {
			delete this.outBoundConnections[index];
			clearGrid(true);
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
	    var timerActivationInSeconds = parseFloat($('#timerActivationInput').val());
	    var timesTimerRuns = parseFloat(parseInt($('#timesInput').val()));
	    var noteInMidi = parseInt($('#noteInput').val());

	    let temp_neuron = undefined;
	    switch (neuronType) {
	      case 'normal':
	        temp_neuron = new Neuron(x, y, cellSize, activationLevel);
	        break;
	      case 'character':
	        temp_neuron = new CharacterNeuron(x, y, cellSize, activationLevel);
	        break;
	      case 'negative':
	      	temp_neuron = new NegativeNeuron(x, y, cellSize, activationLevel);
	      	break;
	      case 'timer': 
	      	temp_neuron = new TimerNeuron(x, y, cellSize, activationLevel, timerActivationInSeconds, timesTimerRuns);
	      	break;
	      case 'note':
	      	temp_neuron = new NoteNeuron(x, y, cellSize, activationLevel, noteInMidi);
	      	break;

	    }
	    neuronList[`${x} ${y}`] = temp_neuron; 
    }
}