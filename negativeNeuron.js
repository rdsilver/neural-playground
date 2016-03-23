'use strict';

class NegativeNeuron extends Neuron {
  constructor(x, y, neuronSize, actlvl) {
    super(x, y, neuronSize, actlvl);
    this.actionPotentialCharge = -1;
  }

  display() {
    this.selected ? fill(200, 200, 60) : fill(0, 100, 200);
    stroke(sketchOptions.gridColor);
    rect(this.xCoord, this.yCoord, this.size, this.size);
  }
}
