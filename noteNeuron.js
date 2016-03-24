// Oscillator
var osc;
osc = new p5.Oscillator();
osc.setType('triangle');
osc.start();
osc.amp(0);

var twelveTones = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

class NoteNeuron extends Neuron {
  constructor(x, y, neuronSize, actlvl, note) {
    super(x, y, neuronSize, actlvl);
    this.note = note;
  }

  display() {
    this.selected ? fill(200, 200, 60) : fill(0, 255, 255);
    stroke(sketchOptions.gridColor);
    rect(this.xCoord, this.yCoord, this.size, this.size);
    fill(0);
    textAlign(CENTER);
    textSize(this.size);
    let letter = '♪';
    text(letter, this.xCoord + this.size/2, this.yCoord + this.size/1.15);
  }

  activate() {
    osc.amp(0.05);
    osc.freq(midiToFreq(this.note));
    _.each(this.outBoundConnections, otherNeuron => {
      let id = _.uniqueId();
      actionPotentialList[`${id}`] = new ActionPotential(this, otherNeuron, this.size/2, id, this.actionPotentialCharge, this.size);
    });
  }

  reset() {
    this.curCharge = 0;
    this.currentSteps = 0;
    osc.amp(0);
  }
}
