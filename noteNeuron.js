'use strict';

// TODO possibly refactor this out into a static method for each neuron type "setup"
// Oscillator
var osc;
osc = new p5.Oscillator();
osc.setType('triangle');
osc.amp(.05);

class NoteNeuron extends Neuron {
	constructor(x, y, neuronSize, actlvl, note) {
		super(x, y, neuronSize, actlvl);
		this.note = note;
	}

	display() {
		this.selected ? fill(200, 200, 60) : fill(0, 255, 255);
		stroke(gridColor);
		rect(this.xCoord, this.yCoord, this.size, this.size);
		fill(0);
		textAlign(CENTER);
		textSize(this.size);
		let letter = '♪';
		text(letter, this.xCoord + this.size/2, this.yCoord + this.size/1.15);
	}

	activate() {
		osc.freq(midiToFreq(this.note));
		osc.stop();
		osc.start();
		_.each(this.outBoundConnections, otherNeuron => {
			let id = _.uniqueId();
			actionPotentialList[`${id}`] = new ActionPotential(this, otherNeuron, this.size/2, id, this.actionPotentialCharge, this.size);
		}); 
	}

	reset() {
		this.curCharge = 0;
		this.currentSteps = 0;
		osc.stop();
		console.log('hello');
	}
}