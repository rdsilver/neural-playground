class RandomNeuron extends Neuron {
  constructor(x, y, neuronSize, actlvl) {
    super(x, y, neuronSize, actlvl);
  }

  display() {
    this.selected ? fill(200, 200, 60) : fill(255, 205, 205);
    stroke(sketchOptions.gridColor);
    rect(this.x, this.y, this.size, this.size);
    fill(0);
    textAlign(CENTER);
    textSize(this.size);

    let letter = 'R';
    text(letter, this.x + this.size/2, this.y + this.size/1.15);
  }

  activate() {
    var randNeuron = _.sample(this.outBoundConnections);
    let id = _.uniqueId();
    actionPotentialList[`${id}`] = new ActionPotential(this, randNeuron, this.size/2, id, this.actionPotentialCharge, this.size);
  }
}
