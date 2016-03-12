'use strict';

class TimerNeuron extends Neuron {
	constructor(x, y, neuronSize, actlvl, timeInSeconds, times) {
		super(x, y, neuronSize, actlvl);
		this.timeInSeconds = timeInSeconds;
		this.lastActivation = 0;
		this.curTime = 0;
		this.maxSteps = times;
		this.currentSteps = 0;
	}

	// TimerNeurons arn't affected by incoming actionPotentials
	addCharge(charge) { }

	display() {
		this.selected ? fill(200, 200, 60) : fill(160, 130, 250);
		stroke(gridColor);
		rect(this.xCoord, this.yCoord, this.size, this.size);
		fill(0);
		textAlign(CENTER);
		textSize(this.size);
		text('T', this.xCoord + this.size/2, this.yCoord + this.size/1.15);
	}

	neuronSpecificRoutine() {
		console.log(this.currentSteps);
		// Send an activation every timeInSeconds, until you reach the max times you should send out
		if (this.maxSteps === -1 || isNaN(this.maxSteps) || this.maxSteps > this.currentSteps) {
			if (state === 'live' && this.lastActivation > this.timeInSeconds * 1000) {
				super.activate();
				this.lastActivation = 0;
				this.curTime = millis();
				this.currentSteps++;
			}
			this.lastActivation = millis() - this.curTime;
		}
	}

	reset() {
		this.curCharge = 0;
		this.currentSteps = 0;
		this.curTime = 0;
	}
}